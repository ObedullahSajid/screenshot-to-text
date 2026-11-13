interface IconProps {
  size?: number;
  className?: string;
}

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
});

export function IconImage({ size = 18, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.8" cy="9.5" r="1.4" />
      <path d="M3.4 17.2 8 12.6l3.1 3 2.6-2.4 6.9 6.4" />
    </svg>
  );
}

export function IconCrop({ size = 18, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M6.5 2.8v14.7h14.7" />
      <path d="M2.8 6.5h14.7v14.7" />
    </svg>
  );
}

export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconMonitor({ size = 18, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="2.8" y="4" width="18.4" height="12.4" rx="2" />
      <path d="M9 20.2h6M12 16.4v3.8" />
    </svg>
  );
}

export function IconPage({ size = 18, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="5" y="2.6" width="14" height="18.8" rx="2" />
      <path d="M8.5 7h7M8.5 10.2h7M8.5 13.4h4.5" />
      <path d="m9.9 16.6 2.1 2.2 2.1-2.2" />
    </svg>
  );
}

export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M6.5 15H5.2A1.7 1.7 0 0 1 3.5 13.3V5.2A1.7 1.7 0 0 1 5.2 3.5h8.1A1.7 1.7 0 0 1 15 5.2v1.3" />
    </svg>
  );
}

export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconDownload({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M12 3.5v11.2M7.6 10.5 12 15l4.4-4.5" />
      <path d="M4.2 17.5v1.3a1.7 1.7 0 0 0 1.7 1.7h12.2a1.7 1.7 0 0 0 1.7-1.7v-1.3" />
    </svg>
  );
}

export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M4 6.5h16M9.2 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6 6.5 6.8 19a1.6 1.6 0 0 0 1.6 1.5h7.2a1.6 1.6 0 0 0 1.6-1.5L18 6.5" />
    </svg>
  );
}

export function IconClock({ size = 17, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </svg>
  );
}

export function IconSettings({ size = 17, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path d="M19.2 13.4a7.6 7.6 0 0 0 0-2.8l2-1.5-2-3.4-2.4 1a7.5 7.5 0 0 0-2.4-1.4L14 2.7h-4l-.4 2.6a7.5 7.5 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a7.5 7.5 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.5Z" />
    </svg>
  );
}

export function IconShield({ size = 14, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.3-7 9.4-4.1-2.1-7-5.1-7-9.4V6l7-2.8Z" />
      <path d="m8.8 11.8 2.2 2.2 4.2-4.4" />
    </svg>
  );
}

export function IconX({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconArrowLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconScan({ size = 18, className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <path d="M4 8V5.6A1.6 1.6 0 0 1 5.6 4H8M16 4h2.4A1.6 1.6 0 0 1 20 5.6V8M20 16v2.4a1.6 1.6 0 0 1-1.6 1.6H16M8 20H5.6A1.6 1.6 0 0 1 4 18.4V16M4 12h16" />
    </svg>
  );
}
