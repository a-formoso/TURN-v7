/* ============================================================
   LAST FARE HOME, SCENE 06, INT. CUSTODY SUITE - DAY — the scene as data.
   Nothing here draws. engine.js reads it and draws each frame.

   The idea: ONE room, ONE state that goes on. `start` is the state the scene opens in.
   Each frame says only what CHANGED since the frame before it (`set`), which camera
   looks at it (`cam`), how long it takes to get there (`into`) and how long it rests (`hold`).
   Everything a frame does not mention stays exactly as the frame before left it.

   Units: metres and radians. x runs west to east, z north to south, y is up.
   A figure's `at` is [x, z] on the floor; `face` is the way it looks (0 = south, pi = north).
   ============================================================ */
const SCENE = {
  id: 'scene-06', film: 'Last Fare Home', heading: 'INT. CUSTODY SUITE - DAY', fps: 12,

  cast: {
    L: { name: 'Liaqat', height: 1.70, swing: [0, -1],
         colours: { top: 0x1e2331, legs: 0x29292c, skin: 0x94704f, shirt: 0x7f97bd, lanyard: 0x1f7a4a, cap: 0x1b1c20 } },
    P: { name: 'Pike', height: 1.80, swing: [1, 1], pen: true,
         colours: { top: 0x38393d, legs: 0x333438, skin: 0xb89c8c, shirt: 0xa9bfe0, lanyard: 0x1f2f55, hair: 0x6b6b68 } }
  },

  /* A pose is ten numbers, always in this order:
     lean, twist, head down, head turn, right arm forward, right arm out, right elbow, left arm forward, left arm out, left elbow */
  poses: {
    L: {
      handsAtBelt:    [0.1, 0, 0.4, 0, -0.2, -0.12, -1.45, -0.2, -0.12, -1.45],
      pullingBelt:    [0.1, 0, 0.4, 0, -0.3, 0.9, -0.5, -0.2, -0.105, -1.45],
      coiling:        [0.05, 0, 0.3, 0, -0.78, -0.1, -1.35, -0.74, -0.1, -1.35],
      settingDown:    [0.138, 0, 0.129, 0, -1.28, 0.048, -0.3, -0.269, -0.03, -0.93],
      turnedToPike:   [0.02, 0, 0.05, -0.55, 0.05, 0.03, -0.2, 0.05, 0.03, -0.2],
      nodding:        [0.02, 0, 0.3, -0.55, -0.476, 0.269, -1.013, 0.05, 0.03, -0.2],
      phoneOverBag:   [0.124, -0.241, 0.25, 0, -1.25, 0.5, -0.35, 0.05, 0.03, -0.2],
      afterPhone:     [0.06, 0, 0.25, 0, -1.234, 0.279, -0.366, -0.043, 0.05, -0.215],
      liftingTub:     [0.147, -0.082, 0.25, 0, -1.212, 0.205, -0.4, -1.212, -0.137, -0.4],
      loweringTub:    [0.098, -0.194, 0.25, 0, -1.1, 0.331, -0.5, -1.1, -0.363, -0.5],
      handsClasped:   [0.02, 0, 0.05, -0.5, -0.22, -0.2, -1.2, -0.22, -0.2, -1.2],
      noddingClasped: [0.02, 0, 0.3, -0.5, -0.22, -0.2, -1.2, -0.22, -0.2, -1.2],
      watchingBag:    [0.02, 0, 0.05, -0.014, -0.22, -0.2, -1.2, -0.22, -0.2, -1.2],
      walking:        [0.02, 0, 0.16, 0, 0.05, 0.03, -0.25, -0.12, 0.1, -0.55]
    },
    P: {
      signing:     [0.2, 0, 0.45, 0, -0.85, 0.02, -0.8, -0.8, 0.1, -1],
      lookingUp:   [0.08, 0, 0.08, 0.55, -0.85, 0.02, -0.8, -0.8, 0.1, -1],
      slidingBag:  [0.42, 0.1, 0.2, 0.2, -1.38, 0.109, -0.55, -1.78, 0.02, -0.08],
      takingElbow: [0.038, 0, 0.098, -0.305, -0.3, 0.5, -0.75, 0.05, 0.095, -0.2],
      guiding:     [0.028, 0, 0.088, -0.043, -0.3, 0.5, -0.75, 0.05, 0.059, -0.2]
    }
  },
  // a small movement a pose keeps making while it is held: [which of the ten numbers, how much, how fast]
  idle: { P: { signing: [5, 0.045, 17] } },

  /* A camera: where it stands, what it looks at, its field of view in degrees.
     far = how many metres the depth picture covers. */
  cameras: {
    WIDE:    { pos: [1.1, 1.59, 5.45],   look: [3.5, 1.2, 2.8],   fov: 50, far: 9.5, role: 'the suite: the desk, the board, both men' },
    COUNTER: { pos: [2.58, 1.555, 1.22], look: [2.95, 1.25, 3.0], fov: 40, far: 9.5, role: 'from behind the counter, on Liaqat' },
    TWO:     { pos: [1.95, 1.5, 1.72],   look: [3.4, 1.4, 3.0],   fov: 42, far: 9.5, role: 'two-shot along the counter' },
    INSERT:  { pos: [3.49, 1.7, 1.75],   look: [3.2, 1.26, 2.5],  fov: 36, far: 6,   role: 'insert: the property bag' },
    PIKE:    { pos: [4.72, 1.5, 1.65],   look: [3.8, 1.32, 2.9],  fov: 36, far: 9.5, role: 'on Pike, Liaqat beyond him' },
    BAG:     { pos: [3.25, 1.66, 1.3],   look: [3.55, 1.24, 2.9], fov: 44, far: 9.5, role: 'from behind the counter: the bag, both men' },
    ELBOW:   { pos: [5.3, 1.5, 5.1],     look: [3.15, 1.08, 3.2], fov: 40, far: 9.5, role: 'in front of them as they turn from the counter' },
    FOLLOW1: { pos: [1.5, 1.5, 2.95],    look: [5.8, 1.15, 4.75], fov: 50, far: 14,  role: 'behind them, crossing the suite' },
    FOLLOW2: { pos: [2.5, 1.5, 3.6],     look: [8.5, 1.15, 5.7],  fov: 50, far: 18,  role: 'behind them, the corridor mouth ahead' },
    FOLLOW3: { pos: [3.6, 1.5, 5.0],     look: [11, 1.15, 5.9],   fov: 50, far: 18,  role: 'behind them, looking down the corridor' },
    CELL:    { pos: [8.2, 1.5, 6.0],     look: [17.5, 0.85, 6.0], fov: 24, far: 14,  role: 'what they walk toward: the open cell' }
  },

  /* A prop has a shape (engine.js knows how to draw it) and the PLACES it can be.
     A place is one of:
       null                                   not seen (in a pocket, still on him)
       { at: [x, y, z] }                      a fixed spot in the room
       { hand: [who, 0 or 1] }                in one hand (0 = right, 1 = left)
       { hands: who }                         held in both hands
       { on: prop }                           inside or on another prop
       { stretch: [who, 0 or 1] }             pulled out from the hip to that hand (the belt, half out of its loops)
     offset, rot and scale adjust it. */
  props: {
    forms: { shape: 'clipboard', places: { desk: { at: [4.0, 1.206, 2.4], rot: [0, 0.3, 0] } } },
    bag:   { shape: 'bag',  places: { desk: { at: [3.3, 1.2, 2.38] }, across: { at: [3.47, 1.2, 2.24] } } },
    seal:  { shape: 'seal', places: { open: null, sealed: { on: 'bag', offset: [0, 0.2, 0] } } },
    belt:  { shape: 'belt', places: { worn: null, pulling: { stretch: ['L', 0], length: 0.85 },
                                      hands: { hands: 'L', offset: [0, -0.03, 0], scale: 0.8 }, counter: { at: [2.72, 1.202, 2.42] } } },
    phone: { shape: 'phone', places: { pocket: null, hand: { hand: ['L', 0], offset: [0, 0.085, -0.01], rot: [0.35, 3.44, 0] },
                                       bag: { on: 'bag', offset: [-0.115, 0.085, 0.01], rot: [0.14, 3.39, 0.1] } } },
    tub:   { shape: 'tub',  places: { counter: { at: [2.42, 1.2, 2.42] }, hands: { hands: 'L', offset: [0, 0.05, 0], minY: 1.3 },
                                      bag: { on: 'bag', offset: [0.05, 0.01, 0] } } }
  },

  // the state the scene opens in
  start: {
    L: { at: [2.85, 2.95], face: 3.142, pose: 'handsAtBelt', stride: 0 },
    P: { at: [4.0, 2.98], face: 3.492, pose: 'signing', stride: 0 },
    props: { forms: 'desk', bag: 'desk', seal: 'open', belt: 'worn', phone: 'pocket', tub: 'counter' }
  },

  /* The scene: beats, the moments inside each beat, the frames inside each moment.
     A frame's id is beat.moment.frame. Only beat 1 of this scene is written so far. */
  beats: [
    { n: 1, name: 'Placates', moments: [
      { n: 1, name: 'The belt', frames: [
        { id: '1.1.1', cam: 'WIDE', into: 0, hold: 1.0,
          says: 'Fluorescent hum. A whiteboard behind the desk lists names in red marker. Liaqat at the counter, hands at his belt. Pike writes.', set: {} },
        { id: '1.1.2', cam: 'WIDE', into: 1.6, hold: 0.4,
          says: 'Liaqat feeds his belt out of its loops.', set: { L: { pose: 'pullingBelt' }, props: { belt: 'pulling' } } },
        { id: '1.1.3', cam: 'COUNTER', into: 1.4, hold: 1.2,
          says: 'He coils it neatly.', set: { L: { pose: 'coiling' }, props: { belt: 'hands' } } },
        { id: '1.1.4', cam: 'COUNTER', into: 1.2, hold: 0.8,
          says: 'Sets it on the counter.', set: { L: { pose: 'settingDown' }, props: { belt: 'counter' } } }
      ] },
      { n: 2, name: 'The questions', frames: [
        { id: '1.2.1', cam: 'TWO', into: 0.9, hold: 1.8,
          says: 'PIKE: Any medication? Thoughts of self-harm?', set: { P: { pose: 'lookingUp' }, L: { pose: 'turnedToPike' } } },
        { id: '1.2.2', cam: 'TWO', into: 0.5, hold: 1.0,
          says: 'LIAQAT: No, sir. No problem.', set: { L: { pose: 'nodding' } } }
      ] },
      { n: 3, name: 'The bag', frames: [
        { id: '1.3.1', cam: 'INSERT', into: 1.0, hold: 0.5,
          says: 'His phone goes to the bag, prayer app still lit.', set: { P: { pose: 'signing' }, L: { pose: 'phoneOverBag' }, props: { phone: 'hand' } } },
        { id: '1.3.2', cam: 'INSERT', into: 0.4, hold: 0.6,
          says: 'It drops in.', set: { L: { pose: 'afterPhone' }, props: { phone: 'bag' } } },
        { id: '1.3.3', cam: 'INSERT', into: 1.0, hold: 0.4,
          says: 'Then Shahana’s Tupperware, rice fogging the lid.', set: { L: { pose: 'liftingTub' }, props: { tub: 'hands' } } },
        { id: '1.3.4', cam: 'INSERT', into: 0.8, hold: 0.6,
          says: 'Into the bag, beside the phone.', set: { L: { pose: 'loweringTub' }, props: { tub: 'bag' } } }
      ] },
      { n: 4, name: 'The solicitor', frames: [
        { id: '1.4.1', cam: 'PIKE', into: 0.8, hold: 2.2,
          says: 'PIKE (signing, not looking up): You’ll want the duty solicitor. Sensible man like you, yeah?', set: { L: { pose: 'handsClasped' } } },
        { id: '1.4.2', cam: 'PIKE', into: 0.4, hold: 1.0,
          says: 'LIAQAT: No problem, sir.', set: { L: { pose: 'noddingClasped' } } }
      ] },
      { n: 5, name: 'The corridor', frames: [
        { id: '1.5.1', cam: 'BAG', into: 0.9, hold: 0.5,
          says: 'Pike slides the sealed bag across', set: { P: { pose: 'slidingBag' }, L: { pose: 'watchingBag' }, props: { bag: 'across', seal: 'sealed' } } },
        { id: '1.5.2', cam: 'ELBOW', into: 1.3, hold: 0.6,
          says: 'and takes his elbow like a host.', set: { P: { pose: 'takingElbow', at: [3.282, 2.997], face: 0.788 }, L: { pose: 'walking', at: [3.0, 3.45], face: 0.788 } } },
        { id: '1.5.3', cam: 'FOLLOW1', into: 1.2, hold: 0,
          says: 'They cross the suite.', set: { P: { pose: 'guiding', at: [3.905, 3.585], face: 0.877, stride: 1 }, L: { at: [3.665, 4.061], face: 0.877, stride: 1 } } },
        { id: '1.5.4', cam: 'FOLLOW2', glide: true, into: 1.2, hold: 0,
          says: 'Down the corridor,', set: { P: { at: [4.909, 4.307], face: 1.087 }, L: { at: [4.773, 4.824], face: 1.087 } } },
        { id: '1.5.5', cam: 'FOLLOW3', glide: true, into: 1.3, hold: 0.6,
          says: 'the corridor ahead of them,', set: { P: { at: [6.096, 4.724], face: 1.535, stride: 0.25 }, L: { at: [6.197, 5.248], face: 1.535, stride: 0.25 } } },
        { id: '1.5.6', cam: 'CELL', into: 0, hold: 2.0,
          says: 'a cell door stands open on a blue mattress.', set: {} }
      ] }
    ] }
  ]
};
