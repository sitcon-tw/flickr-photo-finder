import { type ReactNode, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

type SheetDialogProps = {
  children: ReactNode;
  isOpen: boolean;
  title: string;
  onOpenChange: (isOpen: boolean) => void;
};

export function SheetDialog({ children, isOpen, title, onOpenChange }: SheetDialogProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ scrollTop: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  function resetDrag() {
    dragStartRef.current = null;
    setDragOffset(0);
  }

  return (
    <ModalOverlay
      className="sheet-overlay"
      isDismissable
      isOpen={isOpen}
      onOpenChange={(open) => {
        resetDrag();
        onOpenChange(open);
      }}
    >
      <Modal className="sheet-modal">
        <Dialog
          className="sheet-dialog"
          ref={sheetRef}
          style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
          onTouchCancel={resetDrag}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0];
            const start = dragStartRef.current;
            if (!touch || !start) {
              resetDrag();
              return;
            }
            const deltaY = touch.clientY - start.y;
            resetDrag();
            if (start.scrollTop <= 0 && deltaY >= 96) {
              onOpenChange(false);
            }
          }}
          onTouchMove={(event) => {
            const touch = event.touches[0];
            const start = dragStartRef.current;
            if (!touch || !start) return;
            const deltaY = touch.clientY - start.y;
            if (start.scrollTop > 0 || deltaY <= 0) return;
            event.preventDefault();
            setDragOffset(Math.min(deltaY, 160));
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (!touch || event.touches.length !== 1) return;
            dragStartRef.current = {
              scrollTop: sheetRef.current?.scrollTop ?? 0,
              y: touch.clientY,
            };
          }}
        >
          <div className="sheet-header">
            <Heading slot="title">{title}</Heading>
            <Button type="button" onPress={() => onOpenChange(false)}>
              關閉
            </Button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
