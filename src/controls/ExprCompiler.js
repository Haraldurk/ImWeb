/**
 * ImWeb Expression Compiler
 *
 * Compiles expression-controller text to a bounded instruction list evaluated
 * by a small stack machine. Replaces `new Function`, whose grammar is open:
 * it accepts any JS expression, including an IIFE containing a loop —
 * `(() => { while (true) {} })()` compiles fine and wedges the render loop
 * at evaluation time, where the tick's try/catch cannot see a hang. Expression
 * text rides in saved projects, so the wedge arrives from outside (#33).
 *
 * The grammar here is closed by construction:
 *   - one variable, `t`, plus the fourteen documented helpers
 *     (sin cos tan abs floor ceil round mod fract clamp mix pow sqrt noise)
 *   - a superset kept so existing projects keep working: ternaries,
 *     comparisons, && || !, ** , `Math.*` constants and pure `Math.*` functions
 *   - everything else — statements, loops, arrow functions, assignments,
 *     object/array literals, member access other than whitelisted `Math.*`,
 *     calls of anything but the whitelisted helpers — fails at COMPILE time
 *
 * The emitted instruction stream contains no backward jumps and no callable
 * references, so evaluation is guaranteed-terminating and cannot allocate
 * beyond one small args array per call. The same flat list is what §8.7 of
 * docs/ImWeb-Audio-Blueprint.md expects to ship to an AudioWorklet — no text
 * crosses that boundary there either.
 *
 * Evaluation semantics are plain JS numbers: 0, -0 and NaN are falsy,
 * comparisons yield 1/0, `&&`/`||` return operand values.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

// name -> [fn, arity]
const HELPERS = {
  sin:   [Math.sin, 1],
  cos:   [Math.cos, 1],
  tan:   [Math.tan, 1],
  abs:   [Math.abs, 1],
  floor: [Math.floor, 1],
  ceil:  [Math.ceil, 1],
  round: [Math.round, 1],
  mod:   [(a, b) => ((a % b) + b) % b, 2],
  fract: [(a) => a - Math.floor(a), 1],
  clamp: [(a, lo, hi) => Math.max(lo, Math.min(hi, a)), 3],
  mix:   [(a, b, t) => a + (b - a) * t, 3],
  pow:   [Math.pow, 2],
  sqrt:  [Math.sqrt, 1],
  noise: [() => Math.random(), 0],
};

const MATH_CONSTS = new Set([
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2',
]);

// Pure functions only — anything on Math that reads or writes outside state
// (or constructs objects) is not on this list.
const MATH_FNS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10',
  'abs', 'floor', 'ceil', 'round', 'trunc', 'sqrt', 'cbrt',
  'pow', 'min', 'max', 'sign', 'hypot', 'random',
]);

class ExprError extends Error {
  constructor(msg, pos) {
    super(pos != null ? `${msg} (at ${pos})` : msg);
    this.name = 'ExprError';
  }
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

const PUNCTS = [
  '===', '!==', '**', '<=', '>=', '==', '!=', '&&', '||',
  '++', '--', '=>',
  '+', '-', '*', '/', '%', '(', ')', ',', '?', ':', '<', '>', '!', '.',
];

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError('malformed number', i);
      toks.push({ kind: 'num', value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      toks.push({ kind: 'ident', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const p = PUNCTS.find((q) => src.startsWith(q, i));
    if (p) {
      if (p === '++' || p === '--' || p === '=>') {
        throw new ExprError(`'${p}' is not allowed in an expression controller`, i);
      }
      toks.push({ kind: 'punct', value: p, pos: i });
      i += p.length;
      continue;
    }
    throw new ExprError(`unexpected character '${c}'`, i);
  }
  toks.push({ kind: 'end', value: '', pos: i });
  return toks;
}

// ── Parser + code generator ─────────────────────────────────────────────────
// Pratt parser emitting the flat instruction list directly. Precedence,
// lowest to highest: ternary, ||, &&, equality, relational, additive,
// multiplicative, exponent (right-assoc), unary, primary.
//
// Instructions (stack machine over JS numbers):
//   ['const', v]      push v
//   ['t']             push the time variable
//   ['neg'] ['not']   unary
//   ['add'|'sub'|'mul'|'div'|'mod'|'pow'|
//    'lt'|'le'|'gt'|'ge'|'eq'|'ne']        binary; comparisons push 1/0
//   ['call', fn, n]   pop n args, push fn(...args)
//   ['jz', target]    pop; jump if falsy                    (ternary)
//   ['jf', target]    jump if falsy, else pop               (&&)
//   ['jt', target]    jump if truthy, else pop              (||)
//   ['jmp', target]

const truthy = (v) => v !== 0 && v === v; // 0, -0 and NaN are falsy

class Compiler {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
    this.code = [];
  }

  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }

  expect(value) {
    const tk = this.next();
    if (tk.kind !== 'punct' || tk.value !== value) {
      throw new ExprError(`expected '${value}', got '${tk.value || 'end of input'}'`, tk.pos);
    }
  }

  atPunct(value) {
    const tk = this.peek();
    return tk.kind === 'punct' && tk.value === value;
  }

  emit(...ins) { this.code.push(ins); }
  patch(at, target) { this.code[at][1] = target; }

  parse() {
    this.ternary();
    const tk = this.peek();
    if (tk.kind !== 'end') {
      throw new ExprError(`unexpected '${tk.value}' after complete expression`, tk.pos);
    }
    return this.code;
  }

  ternary() {
    this.logicalOr();
    if (!this.atPunct('?')) return;
    this.next();
    const jzAt = this.code.length;
    this.emit('jz', null);
    this.ternary();                      // then-branch: right-assoc nesting
    const jmpAt = this.code.length;
    this.emit('jmp', null);
    this.expect(':');
    this.patch(jzAt, this.code.length);  // else-branch
    this.ternary();
    this.patch(jmpAt, this.code.length);
  }

  logicalOr() {
    this.logicalAnd();
    while (this.atPunct('||')) {
      this.next();
      const jtAt = this.code.length;
      this.emit('jt', null);
      this.logicalAnd();
      this.patch(jtAt, this.code.length);
    }
  }

  logicalAnd() {
    this.equality();
    while (this.atPunct('&&')) {
      this.next();
      const jfAt = this.code.length;
      this.emit('jf', null);
      this.equality();
      this.patch(jfAt, this.code.length);
    }
  }

  equality() {
    this.relational();
    for (;;) {
      let op = null;
      if (this.atPunct('==') || this.atPunct('===')) op = 'eq';
      else if (this.atPunct('!=') || this.atPunct('!==')) op = 'ne';
      if (!op) return;
      this.next();
      this.relational();
      this.emit(op);
    }
  }

  relational() {
    this.additive();
    for (;;) {
      const map = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };
      const tk = this.peek();
      const op = tk.kind === 'punct' ? map[tk.value] : null;
      if (!op) return;
      this.next();
      this.additive();
      this.emit(op);
    }
  }

  additive() {
    this.multiplicative();
    for (;;) {
      let op = null;
      if (this.atPunct('+')) op = 'add';
      else if (this.atPunct('-')) op = 'sub';
      if (!op) return;
      this.next();
      this.multiplicative();
      this.emit(op);
    }
  }

  multiplicative() {
    this.unary();
    for (;;) {
      let op = null;
      if (this.atPunct('*')) op = 'mul';
      else if (this.atPunct('/')) op = 'div';
      else if (this.atPunct('%')) op = 'mod';
      if (!op) return;
      this.next();
      this.unary();
      this.emit(op);
    }
  }

  unary() {
    if (this.atPunct('-')) { this.next(); this.unary(); this.emit('neg'); return; }
    if (this.atPunct('+')) { this.next(); this.unary(); return; }
    if (this.atPunct('!')) { this.next(); this.unary(); this.emit('not'); return; }
    this.exponent();
  }

  // Right-associative; binds tighter than unary on the left (-t**2 = -(t**2)),
  // looser on the right (2**-3).
  exponent() {
    this.primary();
    if (this.atPunct('**')) {
      this.next();
      this.unary();
      this.emit('pow');
    }
  }

  primary() {
    const tk = this.next();

    if (tk.kind === 'num') { this.emit('const', tk.value); return; }

    if (tk.kind === 'punct' && tk.value === '(') {
      this.ternary();
      this.expect(')');
      return;
    }

    if (tk.kind === 'ident') {
      const name = tk.value;

      if (name === 't') { this.emit('t'); return; }
      if (name === 'Infinity') { this.emit('const', Infinity); return; }
      if (name === 'NaN') { this.emit('const', NaN); return; }

      if (name === 'Math') {
        this.expect('.');
        const member = this.next();
        if (member.kind !== 'ident') {
          throw new ExprError('expected a name after Math.', member.pos);
        }
        if (MATH_CONSTS.has(member.value)) {
          this.emit('const', Math[member.value]);
          return;
        }
        if (MATH_FNS.has(member.value)) {
          this.emit('call', Math[member.value], this.callArgs(member.pos, `Math.${member.value}`));
          return;
        }
        throw new ExprError(`Math.${member.value} is not allowed`, member.pos);
      }

      const helper = HELPERS[name];
      if (helper) {
        const argc = this.callArgs(tk.pos, name);
        if (argc !== helper[1]) {
          throw new ExprError(`${name}() takes ${helper[1]} argument(s), got ${argc}`, tk.pos);
        }
        this.emit('call', helper[0], argc);
        return;
      }

      throw new ExprError(`unknown name '${name}'`, tk.pos);
    }

    throw new ExprError(`unexpected '${tk.value || 'end of input'}'`, tk.pos);
  }

  // Parses '( a, b, ... )' and returns the argument count.
  callArgs(pos, name) {
    if (!this.atPunct('(')) {
      throw new ExprError(`'${name}' is a function — call it as ${name}(…)`, pos);
    }
    this.next();
    let argc = 0;
    if (!this.atPunct(')')) {
      for (;;) {
        this.ternary();
        argc++;
        if (this.atPunct(',')) { this.next(); continue; }
        break;
      }
    }
    this.expect(')');
    return argc;
  }
}

// ── Evaluator ───────────────────────────────────────────────────────────────

// Stack depth is computed exactly: straight-line deltas are known, and the
// three jump ops are peek-or-pop so fall-through and target agree within one
// slot — tracked at emission time would need label fixups, so instead we walk
// the finished list once, simulating both paths at each branch.
function maxStackDepth(code) {
  const ends = new Array(code.length).fill(-1); // depth at entry of each ip
  const work = [[0, 0]];
  let max = 0;
  while (work.length) {
    const [ip, depth] = work.pop();
    if (ip >= code.length) continue;
    if (ends[ip] >= depth) continue;             // already visited at >= depth
    ends[ip] = depth;
    max = Math.max(max, depth);
    const [op, a, b] = code[ip];
    switch (op) {
      case 'const': case 't': work.push([ip + 1, depth + 1]); break;
      case 'neg': case 'not': work.push([ip + 1, depth]); break;
      case 'call': work.push([ip + 1, depth - b + 1]); break;
      case 'jz': work.push([ip + 1, depth - 1], [a, depth - 1]); break;
      case 'jf': case 'jt': work.push([ip + 1, depth - 1], [a, depth]); break;
      case 'jmp': work.push([a, depth]); break;
      default: work.push([ip + 1, depth - 1]); break; // binary
    }
  }
  return max;
}

function makeRunner(code) {
  const stack = new Float64Array(Math.max(1, maxStackDepth(code)));
  return function run(t) {
    let sp = 0;
    let ip = 0;
    for (;;) {
      if (ip >= code.length) break;
      const ins = code[ip++];
      switch (ins[0]) {
        case 'const': stack[sp++] = ins[1]; break;
        case 't':     stack[sp++] = t; break;
        case 'neg':   stack[sp - 1] = -stack[sp - 1]; break;
        case 'not':   stack[sp - 1] = truthy(stack[sp - 1]) ? 0 : 1; break;
        case 'add':   stack[sp - 2] += stack[sp - 1]; sp--; break;
        case 'sub':   stack[sp - 2] -= stack[sp - 1]; sp--; break;
        case 'mul':   stack[sp - 2] *= stack[sp - 1]; sp--; break;
        case 'div':   stack[sp - 2] /= stack[sp - 1]; sp--; break;
        case 'mod':   stack[sp - 2] %= stack[sp - 1]; sp--; break;
        case 'pow':   stack[sp - 2] = stack[sp - 2] ** stack[sp - 1]; sp--; break;
        case 'lt':    stack[sp - 2] = stack[sp - 2] <  stack[sp - 1] ? 1 : 0; sp--; break;
        case 'le':    stack[sp - 2] = stack[sp - 2] <= stack[sp - 1] ? 1 : 0; sp--; break;
        case 'gt':    stack[sp - 2] = stack[sp - 2] >  stack[sp - 1] ? 1 : 0; sp--; break;
        case 'ge':    stack[sp - 2] = stack[sp - 2] >= stack[sp - 1] ? 1 : 0; sp--; break;
        case 'eq':    stack[sp - 2] = stack[sp - 2] === stack[sp - 1] ? 1 : 0; sp--; break;
        case 'ne':    stack[sp - 2] = stack[sp - 2] !== stack[sp - 1] ? 1 : 0; sp--; break;
        case 'call': {
          const argc = ins[2];
          const args = new Array(argc);
          for (let k = argc - 1; k >= 0; k--) args[k] = stack[--sp];
          stack[sp++] = ins[1](...args);
          break;
        }
        case 'jz': { const v = stack[--sp]; if (!truthy(v)) ip = ins[1]; break; }
        case 'jf': { if (!truthy(stack[sp - 1])) ip = ins[1]; else sp--; break; }
        case 'jt': { if (truthy(stack[sp - 1])) ip = ins[1]; else sp--; break; }
        case 'jmp': ip = ins[1]; break;
        /* istanbul ignore next */
        default: throw new ExprError(`bad opcode '${ins[0]}'`);
      }
    }
    return sp > 0 ? stack[sp - 1] : NaN;
  };
}

/**
 * Compile expression-controller text to a bounded evaluator.
 *
 * @param {string} src  expression text from the controller config
 * @returns {(t: number) => number}  guaranteed-terminating evaluator
 * @throws {ExprError}  on anything outside the closed grammar
 */
export function compileExpression(src) {
  const code = new Compiler(tokenize(String(src))).parse();
  if (code.length === 0) throw new ExprError('empty expression');
  return makeRunner(code);
}

export { ExprError };
