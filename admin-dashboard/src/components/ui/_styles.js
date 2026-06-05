/**
 * Pure variant → Tailwind-class mappers for the UI component library.
 * Kept in a .js (not .jsx) module so Node-based smoke tests can import
 * and assert on the produced class strings without needing JSX support.
 *
 * Each function returns a STRING — components compose this with cn()
 * alongside their own structural classes.
 */

// ─── Button ───
const BUTTON_BASE = [
  'inline-flex items-center justify-center font-medium rounded-md',
  'transition-colors duration-150',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

const BUTTON_VARIANTS = {
  primary:   'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500',
  secondary: 'bg-secondary-100 text-secondary-900 hover:bg-secondary-200 focus-visible:ring-secondary-400',
  danger:    'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500',
  ghost:     'bg-transparent text-secondary-700 hover:bg-secondary-100 focus-visible:ring-secondary-300',
  outline:   'bg-white text-secondary-900 border border-secondary-300 hover:bg-secondary-50 focus-visible:ring-secondary-400',
};

const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function getButtonClasses({ variant = 'primary', size = 'md', fullWidth = false } = {}) {
  const variantCls = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  const sizeCls = BUTTON_SIZES[size] || BUTTON_SIZES.md;
  return [BUTTON_BASE, variantCls, sizeCls, fullWidth ? 'w-full' : ''].join(' ').trim();
}

// ─── Input ───
const INPUT_BASE = [
  'block w-full rounded-md border bg-white px-3 text-sm',
  'placeholder:text-secondary-400',
  'focus:outline-none focus:ring-2 focus:ring-offset-0',
  'disabled:bg-secondary-50 disabled:cursor-not-allowed disabled:text-secondary-500',
].join(' ');

export function getInputClasses({ error = false, size = 'md' } = {}) {
  const sizeCls = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-12 text-base' : 'h-10';
  const stateCls = error
    ? 'border-danger-400 focus:border-danger-500 focus:ring-danger-400'
    : 'border-secondary-300 focus:border-primary-500 focus:ring-primary-400';
  return [INPUT_BASE, sizeCls, stateCls].join(' ');
}

// ─── Badge ───
const BADGE_VARIANTS = {
  success: 'bg-success-100 text-success-800 ring-success-200',
  warning: 'bg-warning-100 text-warning-800 ring-warning-200',
  danger:  'bg-danger-100  text-danger-800  ring-danger-200',
  info:    'bg-info-100    text-info-800    ring-info-200',
  neutral: 'bg-secondary-100 text-secondary-800 ring-secondary-200',
};

export function getBadgeClasses({ variant = 'neutral', size = 'md' } = {}) {
  const variantCls = BADGE_VARIANTS[variant] || BADGE_VARIANTS.neutral;
  const sizeCls = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';
  return [
    'inline-flex items-center gap-1 rounded-full ring-1 ring-inset font-medium',
    variantCls, sizeCls,
  ].join(' ');
}

// ─── Alert ───
const ALERT_VARIANTS = {
  info:    'bg-info-50    border-info-300    text-info-900',
  success: 'bg-success-50 border-success-300 text-success-900',
  warning: 'bg-warning-50 border-warning-300 text-warning-900',
  error:   'bg-danger-50  border-danger-300  text-danger-900',
};

export function getAlertClasses({ variant = 'info' } = {}) {
  const variantCls = ALERT_VARIANTS[variant] || ALERT_VARIANTS.info;
  return ['rounded-md border-l-4 p-4 text-sm', variantCls].join(' ');
}

// ─── Spinner ───
export function getSpinnerSizeClass(size = 'md') {
  return size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';
}
export function getSpinnerColorClass(variant = 'primary') {
  return variant === 'white' ? 'text-white' : 'text-primary-600';
}

// ─── Modal ───
const MODAL_SIZES = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  full: 'max-w-[95vw]',
};
export function getModalSizeClass(size = 'md') {
  return MODAL_SIZES[size] || MODAL_SIZES.md;
}

// Exported for tests
export const _maps = {
  BUTTON_VARIANTS, BUTTON_SIZES,
  BADGE_VARIANTS, ALERT_VARIANTS, MODAL_SIZES,
};
