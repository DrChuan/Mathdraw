import {normalizeDrawing} from './model';
import type {DrawingChange,DrawingDocument} from './types';

/** Validate inside the workspace so commit errors cannot hide behind its modal. */
export function submitConstraintDrawing(next:DrawingDocument,change:DrawingChange) {
  const prepared=normalizeDrawing(next);
  if(!change(prepared))throw new Error('未能放入绘图区，画布未更新；请检查绘图数据后重试。');
}
