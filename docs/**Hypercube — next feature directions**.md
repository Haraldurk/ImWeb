**Hypercube — next feature directions**

**Edge width** — `LineSegments` in Three.js doesn't support variable width (WebGL limitation). The path is `TubeGeometry` per edge, or a custom line shader using `gl_FragCoord` with a width uniform. The shader approach is faster and already fits the architecture — one new `ShaderMaterial` replacing `LineBasicMaterial`, with `uEdgeWidth` uniform wired to the existing `_colorsDirty` pattern.

**Object instancing at vertices** — `InstancedMesh` with any ImWeb geometry. The vertex subscriber API (`subscribeVertex`) is already built and working. The Cloner is the right reference — same pattern, different driver. Each of the 4096 vertices at 12D becomes an instance position updated every frame from `_projBuf`.

**Surfaces / faces** — 2-cell faces (squares) are enumerable from `generate2CellCentroids()` which is already in `HypercubeGeometry.js`. Rendering them as `THREE.Mesh` with `PlaneGeometry` quads, oriented by face normal, gives you textured hypercube faces. At 4D that's 24 faces — very manageable. At 8D it's 1792 faces — still feasible with instancing.

**Texture on faces** — once faces are meshes, any ImWeb pipeline output (camera, SDF, movie) can be assigned as the face material texture. The hypercube becomes a video surface unfolding through dimensions.

**Audio reactivity** — rotation plane speeds already accept direct writes to `rotationSpeeds[d]`. FFT band → rotation speed is one binding, same pattern as Barlowgen's LFO system.

**MIDI performance** — dimension pills already exist. MIDI note → `morphTo()` makes each note a dimensional jump. Pitch bend → `wDistance` warps the perspective in real time.