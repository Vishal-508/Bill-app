import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { getModalSizeClass } from './_styles.js';

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  footer,
  closable = true,
  className,
  children,
}) {
  return (
    <Transition appear show={!!open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={closable ? onClose : () => {}}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"  leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-secondary-900/50 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"  leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                className={cn(
                  'w-full transform overflow-hidden rounded-lg bg-white shadow-xl transition-all',
                  getModalSizeClass(size),
                  className,
                )}
              >
                {(title || closable) && (
                  <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-secondary-200">
                    {title && (
                      <Dialog.Title className="text-lg font-semibold text-secondary-900">
                        {title}
                      </Dialog.Title>
                    )}
                    {closable && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="text-secondary-400 hover:text-secondary-600 rounded p-1"
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                )}
                <div className="px-6 py-4">{children}</div>
                {footer && (
                  <div className="px-6 py-3 border-t border-secondary-200 bg-secondary-50 flex justify-end gap-2">
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

export default Modal;
