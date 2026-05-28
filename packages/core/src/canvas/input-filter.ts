export type FilterAction = 'dispatch' | 'suppress' | 'defer';

export interface FilteredEvent {
  event: PointerEvent;
  action: FilterAction;
}

export interface FilteredUpEvent extends FilteredEvent {
  pendingTap?: { x: number; y: number };
}

export class InputFilter {
  private activePenId: number | null = null;
  private pendingTap: { pointerId: number; x: number; y: number } | null = null;

  static readonly MIN_MOVE_DISTANCE = 3;

  filterDown(e: PointerEvent): FilteredEvent {
    if (e.pointerType === 'pen') {
      this.activePenId = e.pointerId;
      return { event: e, action: 'dispatch' };
    }

    if (e.pointerType === 'touch' && this.activePenId !== null) {
      return { event: e, action: 'suppress' };
    }

    if (e.pointerType === 'touch') {
      this.pendingTap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return { event: e, action: 'defer' };
    }

    return { event: e, action: 'dispatch' };
  }

  filterMove(e: PointerEvent): FilteredEvent {
    if (e.pointerType === 'touch' && this.activePenId !== null) {
      return { event: e, action: 'suppress' };
    }

    if (this.pendingTap && e.pointerId === this.pendingTap.pointerId) {
      const dx = e.clientX - this.pendingTap.x;
      const dy = e.clientY - this.pendingTap.y;
      if (dx * dx + dy * dy > InputFilter.MIN_MOVE_DISTANCE * InputFilter.MIN_MOVE_DISTANCE) {
        this.pendingTap = null;
        return { event: e, action: 'dispatch' };
      }
      return { event: e, action: 'suppress' };
    }

    return { event: e, action: 'dispatch' };
  }

  filterUp(e: PointerEvent): FilteredUpEvent {
    if (e.pointerId === this.activePenId) {
      this.activePenId = null;
      return { event: e, action: 'dispatch' };
    }

    if (e.pointerType === 'touch' && this.activePenId !== null) {
      return { event: e, action: 'suppress' };
    }

    if (this.pendingTap && e.pointerId === this.pendingTap.pointerId) {
      const tap = { x: this.pendingTap.x, y: this.pendingTap.y };
      this.pendingTap = null;
      return { event: e, action: 'dispatch', pendingTap: tap };
    }

    return { event: e, action: 'dispatch' };
  }

  reset(): void {
    this.activePenId = null;
    this.pendingTap = null;
  }
}
