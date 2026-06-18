"""
monty-bridge.py — Monty signal server for ImWeb.

Phase 2 (mock):  Emits synthetic saccade / confidence / prediction_error signals.
Phase 3.0 (live): Runs real Monty inference on frames received from ImWeb.

Usage:
  pip install websockets
  python monty-bridge.py                          # mock mode, 15 Hz
  python monty-bridge.py --live                   # live Monty inference
  python monty-bridge.py --live --steps 30        # fewer steps per episode
  python monty-bridge.py --live --min-interval 0.3
"""

import argparse
import asyncio
import json
import math
import queue
import random
import threading
import time
from io import BytesIO
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--hz",   type=float, default=15.0, help="Mock emission rate (default 15)")
    p.add_argument("--port", type=int,   default=8765, help="WebSocket port (default 8765)")
    p.add_argument("--live", action="store_true",      help="Use real Monty inference")
    p.add_argument("--steps", type=int,  default=50,   help="Steps per Monty episode (default 50)")
    p.add_argument("--min-interval", type=float, default=0.5,
                   help="Min seconds between accepted frames (default 0.5)")
    p.add_argument("--governor", choices=["adaptive", "static"], default="adaptive",
                   help="Frame governor mode (default adaptive)")
    p.add_argument("--model", choices=["pretrained", "self"], default="pretrained",
                   help="Model mode: pretrained YCB or self-supervised (default pretrained)")
    p.add_argument("--confidence-agg", choices=["mean", "max"], default="mean",
                   help="Confidence aggregation across LMs (default mean)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Phase 2 — mock signal generator (unchanged)
# ---------------------------------------------------------------------------

def compute_message(t: float, prev_sx: float, hz: float) -> dict:
    sx = 0.5 + 0.5 * math.sin(t * 0.3)          # period 2π/0.3 ≈ 21 s
    sy = 0.5 + 0.5 * math.sin(t * 0.17 + 1.2)   # period 2π/0.17 ≈ 37 s

    # Discrete velocity of saccade[0]; expected max = amplitude × angular_freq = 0.5 × 0.3 = 0.15
    vel      = abs(sx - prev_sx) * hz
    vel_norm = min(vel / 0.15, 1.0)

    # Confidence drops while saccade sweeps, rises when settled
    confidence = max(0.0, min(1.0,
        (1.0 - vel_norm) + random.uniform(-0.05, 0.05)
    ))

    # Prediction error: baseline + Poisson spikes biased toward high saccade velocity
    spike_prob       = (0.5 / hz) + vel_norm * (1.5 / hz)
    prediction_error = 0.05 + random.uniform(-0.02, 0.02)
    if random.random() < spike_prob:
        prediction_error = 0.9 + random.uniform(-0.05, 0.05)
    prediction_error = max(0.0, min(1.0, prediction_error))

    return {
        "v": 1,
        "t": int(time.time() * 1000),
        "saccade":          [round(sx, 4), round(sy, 4)],
        "confidence":        round(confidence, 4),
        "prediction_error":  round(prediction_error, 4),
        "source":           "mock",
    }


async def run_mock(hz: float, port: int):
    import websockets

    connected: set = set()

    async def handler(ws):
        connected.add(ws)
        try:
            await ws.wait_closed()
        finally:
            connected.discard(ws)

    async def broadcast():
        t       = 0.0
        prev_sx = 0.5
        dt      = 1.0 / hz
        while True:
            msg     = compute_message(t, prev_sx, hz)
            prev_sx = msg["saccade"][0]
            payload = json.dumps(msg)
            if connected:
                await asyncio.gather(
                    *[ws.send(payload) for ws in connected.copy()],
                    return_exceptions=True,
                )
            t  += dt
            await asyncio.sleep(dt)

    async with websockets.serve(handler, "localhost", port):
        print(f"Monty bridge listening on ws://localhost:{port}  ({hz} Hz, mock mode)",
              flush=True)
        await broadcast()


# ---------------------------------------------------------------------------
# Phase 4 — adaptive governor
# ---------------------------------------------------------------------------

class AdaptiveGovernor:
    def __init__(self, min_interval=0.15, max_interval=2.0, initial=0.5):
        self._min = min_interval
        self._max = max_interval
        self.current = initial
        self._last_accepted = 0.0

    def accept(self, now: float) -> bool:
        if now - self._last_accepted >= self.current:
            self._last_accepted = now
            return True
        return False

    def update(self, peak_pe: float):
        target = self._min + (self._max - self._min) * peak_pe
        self.current = self.current * 0.7 + target * 0.3
        self.current = max(self._min, min(self._max, self.current))


class StaticGovernor:
    def __init__(self, interval=0.5):
        self.current = interval
        self._last_accepted = 0.0

    def accept(self, now: float) -> bool:
        if now - self._last_accepted >= self.current:
            self._last_accepted = now
            return True
        return False

    def update(self, peak_pe: float):
        pass


# ---------------------------------------------------------------------------
# Phase 3.0 — live Monty inference
# ---------------------------------------------------------------------------

_IMG_W, _IMG_H = 320, 240


def _setup_scene_folder(data_path: Path):
    """Create data_path/ with blank rgb_0.png and depth_0.data."""
    import numpy as np

    data_path.mkdir(parents=True, exist_ok=True)

    # Seed frame: black RGB + uniform depth at 0.2
    # Depth must be < 0.4 (process_depth_data clips above) and < 1.0 (semantic_id gate)
    depth_path = data_path / "depth_0.data"
    np.full((_IMG_H, _IMG_W), 0.2, dtype=np.float32).tofile(str(depth_path))

    rgb_path = data_path / "rgb_0.png"
    from PIL import Image
    Image.new("RGB", (_IMG_W, _IMG_H), (0, 0, 0)).save(str(rgb_path))

    return data_path


def _setup_monty(model_path: str, model_mode: str = "pretrained"):
    """Load Monty experiment via Hydra config — returns (model, env, env_interface)."""
    import numpy as np
    import hydra
    from hydra.core.global_hydra import GlobalHydra

    import os
    os.environ.setdefault("MONTY_MODELS", str(Path.home() / "tbp/results/monty/pretrained_models"))
    os.environ.setdefault("MONTY_DATA", str(Path.home() / "tbp/data"))
    os.environ.setdefault("MONTY_LOGS", str(Path.home() / "tbp/results/monty/logs"))

    # Scene folder must exist BEFORE env constructor runs (it blocks waiting for data)
    data_path = Path.home() / "tbp/data/worldimages/world_data_stream"
    _setup_scene_folder(data_path)

    from tbp.monty.hydra import register_resolvers
    register_resolvers()

    overrides = [
        "experiment=tutorial/monty_meets_world_2dimage_inference",
        "environment=two_d_data_stream",
        "env_interface=eval_stream",
        "logging=silent_warning_monty_runs",
        "experiment.config.max_eval_steps=1000",
        "experiment.config.show_sensor_output=false",
    ]

    if model_mode == "self":
        overrides.append("monty=noresetevidencegraph_exp20_e3_t3_tot2500")
    else:
        overrides.append(f"experiment.config.model_name_or_path={model_path}")

    conf_dir = str(Path.home() / "tbp/tbp.monty/src/tbp/monty/conf")
    GlobalHydra.instance().clear()
    with hydra.initialize_config_dir(config_dir=conf_dir, version_base=None):
        cfg = hydra.compose(
            config_name="experiment",
            overrides=overrides,
        )

    exp = hydra.utils.instantiate(cfg.experiment)
    exp.setup_experiment(exp.config)

    from tbp.monty.frameworks.experiments.mode import ExperimentMode
    exp.model.set_experiment_mode(ExperimentMode.EVAL)

    return exp.model, exp.env, exp.eval_env_interface


def _monty_thread(model, env, env_interface, frame_queue, signal_queue, n_steps,
                   confidence_agg="mean", governor=None):
    """Background thread: waits for frames, runs Monty episodes, emits signals."""
    import numpy as np
    import random as _rng
    from PIL import Image
    from tbp.monty.context import RuntimeContext
    from tbp.monty.frameworks.actions.actions import LookUp, LookDown, TurnLeft, TurnRight

    rgb_path = env.data_path / "rgb_0.png"
    depth_path = env.data_path / "depth_0.data"
    rng = np.random.RandomState(42)

    print("Monty thread ready", flush=True)

    while True:
        frame_bytes = frame_queue.get()

        try:
            img = Image.open(BytesIO(frame_bytes)).convert("RGB")
        except Exception as e:
            print(f"Monty: bad frame ({e})", flush=True)
            continue

        img = img.resize((_IMG_W, _IMG_H))
        img.save(str(rgb_path))

        # Luminance-as-depth: image brightness → depth topology
        # Range 0.05–0.35: must stay < 0.4 (process_depth_data clips above)
        # and < 1.0 (DepthTo3DLocations semantic_id gate)
        rgb_arr = np.array(img, dtype=np.float64)
        gray = np.mean(rgb_arr, axis=2)
        depth = (0.05 + 0.30 * (gray / 255.0)).astype(np.float32)
        depth.tofile(str(depth_path))

        env.switch_to_scene(0)
        H, W = env.current_rgb_image.shape[:2]

        primary_target = {
            "object": "no_label",
            "rotation": (1.0, 0.0, 0.0, 0.0),
            "euler_rotation": np.array([0, 0, 0]),
            "quat_rotation": [1, 0, 0, 0],
            "position": np.array([0, 0, 0]),
            "scale": [1.0, 1.0, 1.0],
        }
        model.pre_episode(primary_target)
        env_interface.pre_episode(rng)
        ctx = RuntimeContext(rng=rng)
        actions = []
        peak_pe = 0.0

        for step in range(n_steps):
            try:
                observations, state = env_interface.step(actions)
                actions = model.step(ctx, observations, state)
                # Motor policy returns [] when flat depth yields no on-object features.
                # Fall back to random saccade so the brain keeps exploring.
                if not actions:
                    _cls = _rng.choice([LookUp, LookDown, TurnLeft, TurnRight])
                    actions = [_cls(
                        agent_id="agent_id_0",
                        rotation_degrees=_rng.randint(10, 30),
                    )]
            except StopIteration:
                break
            except Exception as e:
                import traceback
                print(f"Monty step {step} error: {e}", flush=True)
                traceback.print_exc()
                break

            # --- saccade ---
            sx = float(env.current_loc[1]) / W
            sy = float(env.current_loc[0]) / H

            # --- confidence: mean evidence across LMs ---
            confidences = []
            for lm in model.learning_modules:
                threshold = max(getattr(lm, "object_evidence_threshold", 1), 1)
                ev = lm.current_mlh.get("evidence", 0) if isinstance(lm.current_mlh, dict) else 0
                confidences.append(ev / threshold)
            agg_fn = np.max if confidence_agg == "max" else np.mean
            confidence = float(np.clip(agg_fn(confidences), 0.0, 1.0))

            # --- prediction error: max evidence delta across LMs ---
            deltas = []
            for lm in model.learning_modules:
                prev = lm.previous_mlh
                curr = lm.current_mlh
                if prev is not None and prev is not curr and isinstance(prev, dict) and isinstance(curr, dict):
                    deltas.append(prev.get("evidence", 0) - curr.get("evidence", 0))
            threshold = max(getattr(model.learning_modules[0], "object_evidence_threshold", 1), 1)
            raw = max(deltas, default=0)
            prediction_error = float(np.clip(raw / threshold, 0.0, 1.0))

            signal = {
                "v": 1,
                "t": int(time.time() * 1000),
                "saccade": [round(sx, 4), round(sy, 4)],
                "confidence": round(confidence, 4),
                "prediction_error": round(prediction_error, 4),
                "source": "live",
                "step": step,
            }
            signal_queue.put_nowait(signal)
            if prediction_error > peak_pe:
                peak_pe = prediction_error

            if model.is_done:
                break

        model.post_episode()
        if governor is not None:
            governor.update(peak_pe)
        env_interface.current_scene = 0


async def run_live(port: int, steps: int, min_interval: float,
                   governor_mode: str = "adaptive", model_mode: str = "pretrained",
                   confidence_agg: str = "mean"):
    import websockets

    model_path = str(
        Path.home()
        / "tbp/results/monty/pretrained_models/pretrained_ycb_v12"
        / "supervised_pre_training_base/pretrained"
    )

    print(f"Loading Monty model (mode={model_mode})...", flush=True)
    model, env, env_interface = _setup_monty(model_path, model_mode)
    n_lms = len(model.learning_modules)
    print(f"LMs: {n_lms}", flush=True)

    if governor_mode == "adaptive":
        governor = AdaptiveGovernor(initial=min_interval)
    else:
        governor = StaticGovernor(interval=min_interval)

    frame_queue = queue.Queue(maxsize=1)
    signal_queue: queue.Queue = queue.Queue()

    t = threading.Thread(
        target=_monty_thread,
        args=(model, env, env_interface, frame_queue, signal_queue, steps),
        kwargs={"confidence_agg": confidence_agg, "governor": governor},
        daemon=True,
    )
    t.start()

    connected: set = set()

    async def handler(ws):
        connected.add(ws)
        try:
            async for message in ws:
                if isinstance(message, bytes):
                    now = time.time()
                    if governor.accept(now):
                        try:
                            frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                        frame_queue.put_nowait(message)
        finally:
            connected.discard(ws)

    async def drain_signals():
        while True:
            batch = []
            try:
                while True:
                    batch.append(signal_queue.get_nowait())
            except queue.Empty:
                pass
            if batch and connected:
                for signal in batch:
                    payload = json.dumps(signal)
                    await asyncio.gather(
                        *[ws.send(payload) for ws in connected.copy()],
                        return_exceptions=True,
                    )
            await asyncio.sleep(0.01)

    async with websockets.serve(handler, "localhost", port):
        gov_label = f"governor={governor_mode}" if governor_mode == "adaptive" else f"static interval={min_interval}s"
        print(
            f"Monty bridge listening on ws://localhost:{port}  "
            f"(live mode, {steps} steps/episode, {gov_label}, "
            f"model={model_mode}, agg={confidence_agg})",
            flush=True,
        )
        await drain_signals()


# ---------------------------------------------------------------------------

def main():
    args = parse_args()
    if args.live:
        asyncio.run(run_live(
            args.port, args.steps, args.min_interval,
            governor_mode=args.governor,
            model_mode=args.model,
            confidence_agg=args.confidence_agg,
        ))
    else:
        asyncio.run(run_mock(args.hz, args.port))


if __name__ == "__main__":
    main()
