/**
 * placeTooltip placement math tests.
 *
 * Verifies:
 *   - Tooltip box stays inside the viewport for anchors on every edge.
 *   - Arrow shift keeps the arrow inside the box and pointing at the anchor.
 */

import { describe, it, expect } from '@jest/globals';
import { placeTooltip } from '../../../components/ui/Tooltip';

const VIEWPORT = { width: 800, height: 600 };
const SIZE = { width: 200, height: 30 };
const MARGIN = 8;

describe('placeTooltip', () => {
  it('centers above the anchor when there is room', () => {
    expect(placeTooltip('top', 400, 100, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height))
      .toEqual({ left: 400, top: 70, arrowShift: 0 });
  });

  it('clamps to the right viewport edge and shifts the arrow back to the anchor', () => {
    expect(placeTooltip('top', 790, 100, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height))
      .toEqual({ left: 692, top: 70, arrowShift: 92 });
  });

  it('clamps to the left viewport edge and shifts the arrow back to the anchor', () => {
    expect(placeTooltip('top', 5, 100, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height))
      .toEqual({ left: 108, top: 70, arrowShift: -92 });
  });

  it('clamps vertically for side=top near the top edge', () => {
    const placement = placeTooltip('top', 400, 10, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height);
    expect(placement.top).toBe(MARGIN);
  });

  it('clamps vertically for side=bottom near the bottom edge', () => {
    const placement = placeTooltip('bottom', 400, 590, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height);
    expect(placement.top).toBe(VIEWPORT.height - SIZE.height - MARGIN);
  });

  it('clamps to the left viewport edge for side=left', () => {
    const placement = placeTooltip('left', 100, 300, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height);
    expect(placement.left).toBe(MARGIN);
    expect(placement.top).toBe(300);
  });

  it('clamps the centered axis for side=right and caps the arrow shift', () => {
    expect(placeTooltip('right', 400, 595, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height))
      .toEqual({ left: 400, top: 577, arrowShift: 7 });
  });

  it('keeps the box inside the viewport for anchors across the whole window', () => {
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    for (const side of sides) {
      for (let x = 0; x <= VIEWPORT.width; x += 25) {
        for (let y = 0; y <= VIEWPORT.height; y += 25) {
          const { left, top, arrowShift } = placeTooltip(
            side, x, y, SIZE.width, SIZE.height, VIEWPORT.width, VIEWPORT.height,
          );
          const boxLeft = side === 'top' || side === 'bottom' ? left - SIZE.width / 2 : left;
          const boxTop = side === 'left' || side === 'right' ? top - SIZE.height / 2 : top;
          expect(boxLeft).toBeGreaterThanOrEqual(MARGIN);
          expect(boxLeft + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width - MARGIN);
          expect(boxTop).toBeGreaterThanOrEqual(MARGIN);
          expect(boxTop + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height - MARGIN);
          const arrowCenter = (side === 'top' || side === 'bottom' ? SIZE.width : SIZE.height) / 2 + arrowShift;
          expect(arrowCenter).toBeGreaterThanOrEqual(MARGIN);
          expect(arrowCenter).toBeLessThanOrEqual(
            (side === 'top' || side === 'bottom' ? SIZE.width : SIZE.height) - MARGIN,
          );
        }
      }
    }
  });
});
