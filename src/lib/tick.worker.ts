// Frame clock for the compositor. Worker timers keep firing at full rate while the window is hidden or minimised,
// where requestAnimationFrame would stop and freeze the published canvas.
const FRAME_MS = 1000 / 30;
setInterval(() => postMessage(0), FRAME_MS);
