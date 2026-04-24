export class VideoAnalysis {
  static ANALYSIS_SIZE = 256;

  constructor() {
    this._canvas = new OffscreenCanvas(256, 256);
    this._ctx    = this._canvas.getContext('2d');
    this.brightPeaks = [];
  }

  update(videoElement) {
    if (!videoElement) { this.brightPeaks = []; return; }
    this._ctx.drawImage(videoElement, 0, 0, 256, 256);
    const frame = this._ctx.getImageData(0, 0, 256, 256);
    this.brightPeaks = this._findPeaks(frame.data, 8);
  }

  // Scan 16×16 grid, find local maxima by luma, return top-n as normalized {x,y}
  _findPeaks(pixels, n) {
    const SIZE = VideoAnalysis.ANALYSIS_SIZE;
    const GRID = 16;
    const CELL = SIZE / GRID; // 16 pixels per cell

    const candidates = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let maxLuma = 0, mx = 0, my = 0;
        for (let cy = 0; cy < CELL; cy++) {
          for (let cx = 0; cx < CELL; cx++) {
            const px  = gx * CELL + cx;
            const py  = gy * CELL + cy;
            const idx = (py * SIZE + px) * 4;
            const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx+1] + 0.114 * pixels[idx+2];
            if (luma > maxLuma) { maxLuma = luma; mx = px; my = py; }
          }
        }
        candidates.push({ x: mx / SIZE, y: my / SIZE, luma: maxLuma });
      }
    }
    candidates.sort((a, b) => b.luma - a.luma);
    return candidates.slice(0, n).map(({ x, y }) => ({ x, y }));
  }
}
