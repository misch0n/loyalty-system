/**
 * Ckyka Rewards component kit — barrel re-export (UI-SPEC §3).
 *
 * Presentational components only: no service calls, no router. Import the
 * design foundation once at the app root via `src/ui/theme.css` (which pulls in
 * the co-located `kit.css`).
 */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { CupStamps } from './CupStamps';
export type { CupStampsProps } from './CupStamps';

export { Field, ConsentRow } from './Field';
export type { FieldProps, ConsentRowProps } from './Field';

export { Sheet } from './Sheet';
export type { SheetProps } from './Sheet';

export { Overlay } from './Overlay';
export type { OverlayProps } from './Overlay';

export { PointsSlider } from './PointsSlider';
export type { PointsSliderProps } from './PointsSlider';

export { CustomerChip } from './CustomerChip';
export type { CustomerChipProps } from './CustomerChip';

export { PinPad } from './PinPad';
export type { PinPadProps } from './PinPad';

export { StatCard } from './Stat';
export type { StatCardProps } from './Stat';

export { ActivityRow } from './ActivityRow';
export type { ActivityRowProps } from './ActivityRow';

export { AlertRow } from './AlertRow';
export type { AlertRowProps, AlertSeverity } from './AlertRow';

export { Banner } from './Banner';
export type { BannerProps, BannerTone } from './Banner';

export { ToastProvider, useToast } from './Toast';
export type { ToastApi, ToastItem, ToastOptions, ToastTone } from './Toast';

export { ScanFrame } from './ScanFrame';
export type { ScanFrameProps } from './ScanFrame';

export { ProtoDrawer } from './ProtoDrawer';
export type { ProtoDrawerProps } from './ProtoDrawer';

export { Eyebrow } from './Eyebrow';
export type { EyebrowProps } from './Eyebrow';

export { TierPill, StatusPill } from './Pills';
export type { TierPillProps, StatusPillProps, PillTone } from './Pills';
