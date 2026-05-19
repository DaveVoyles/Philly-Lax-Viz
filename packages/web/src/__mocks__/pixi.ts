// Stub for pixi.js in Node.js test environment (no navigator/canvas)
export class Application {
  stage = { addChild: () => {}, removeChild: () => {} };
  renderer = { resize: () => {} };
  canvas = { style: {} };
  ticker = { add: () => {} };
  async init() {}
  destroy() {}
}

export class Graphics {
  alpha = 1;
  visible = true;
  clear() { return this; }
  roundRect() { return this; }
  fill() { return this; }
  destroy() {}
}
