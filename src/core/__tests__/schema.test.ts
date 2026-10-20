import { describe, expect, it } from 'vitest';
import { Op } from '../ops/schema';

describe('update ops carry only what was sent', () => {
  it('set_style does not fill defaults', () => {
    expect(Op.parse({ op: 'set_style', roofColor: '#112233' })).toEqual({ op: 'set_style', roofColor: '#112233' });
  });
  it('update_opening does not reset alignment', () => {
    expect(Op.parse({ op: 'update_opening', opening: 'w1', width: 4 })).toEqual({ op: 'update_opening', opening: 'w1', width: 4 });
  });
  it('update_stairs keeps the shape unless given', () => {
    expect(Op.parse({ op: 'update_stairs', stairs: 'st1', width: 4 })).toEqual({ op: 'update_stairs', stairs: 'st1', width: 4 });
  });
});
