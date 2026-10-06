import { useRef, type ReactNode } from 'react';
import { Modal, Drawer } from 'antd';
export function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
  overlayClassName = '',
  initialFocus,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  overlayClassName?: string;
  initialFocus?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const focus = (open: boolean) => {
    if (open && initialFocus) contentRef.current?.querySelector<HTMLElement>(initialFocus)?.focus();
  };
  const heading = (
    <div className="av-dialog-title">
      <h2>{title}</h2>
    </div>
  );
  const content = (
    <div ref={contentRef} className={className}>
      {subtitle && <p className="av-dialog-subtitle">{subtitle}</p>}
      {children}
    </div>
  );
  if (overlayClassName.includes('av-drawer-overlay'))
    return (
      <Drawer
        open
        title={heading}
        onClose={onClose}
        size={560}
        rootClassName="av-ui-drawer"
        afterOpenChange={focus}
        keyboard
        mask={{ closable: true }}
        styles={{ body: { padding: 0 } }}
      >
        {content}
      </Drawer>
    );
  return (
    <Modal
      open
      centered
      title={heading}
      onCancel={onClose}
      footer={null}
      width={wide ? 820 : className.includes('template-modal') ? 920 : 600}
      rootClassName="av-ui-modal"
      afterOpenChange={focus}
      focusable={{ trap: true, focusTriggerAfterClose: true }}
      mask={{ closable: true }}
    >
      {content}
    </Modal>
  );
}
