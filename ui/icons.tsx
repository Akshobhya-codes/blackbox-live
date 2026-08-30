// Compact stroke icon set. One consistent visual weight across the whole UI.

import type { ReactElement } from "react";

interface P {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
});

export const IconTruck = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M2 8h11v9H2zM13 11h4l3 3v3h-7z" />
    <circle cx="6" cy="18.5" r="1.6" />
    <circle cx="17" cy="18.5" r="1.6" />
  </svg>
);

export const IconForklift = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 5h6v10H3zM15 15V4M15 4h4M11 15h4" />
    <circle cx="5.5" cy="18" r="1.7" />
    <circle cx="12" cy="18" r="1.7" />
  </svg>
);

export const IconBell = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
    <path d="M10.5 19a2 2 0 0 0 3 0" />
  </svg>
);

export const IconRack = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 4v16M21 4v16M3 9h18M3 15h18M3 4h18" />
  </svg>
);

export const IconMedical = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M12 10v5M9.5 12.5h5" />
  </svg>
);

export const IconRadio = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="3" y="9" width="18" height="11" rx="2" />
    <path d="M7 9V5l8 2" />
    <circle cx="8" cy="14.5" r="2" />
    <path d="M14 13h4M14 16.5h4" />
  </svg>
);

export const IconSmoke = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 17h11a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.3A3.6 3.6 0 0 0 6 17z" />
  </svg>
);

export const IconDroplet = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 3s6 6.4 6 10a6 6 0 0 1-12 0c0-3.6 6-10 6-10z" />
  </svg>
);

export const IconFlame = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 3s5 4.6 5 9a5 5 0 0 1-10 0c0-2 1.4-3.6 2.5-4.6 0 2 .8 3 1.7 3.2C11 9 12 6 12 3z" />
  </svg>
);

export const IconMegaphone = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 10v4h3l9 4V6l-9 4H4zM19 10.5v3" />
  </svg>
);

export const IconExit = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9" />
  </svg>
);

export const IconAlert = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 4 2.5 20h19L12 4zM12 10v4M12 17h.01" />
  </svg>
);

export const IconClock = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconPin = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const IconDoc = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </svg>
);

export const IconShare = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
  </svg>
);

export const IconKebab = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </svg>
);

export const IconGraph = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="5.5" cy="18" r="2.2" />
    <circle cx="18.5" cy="18" r="2.2" />
    <path d="M12 7.2 6.6 15.9M12 7.2l5.4 8.7M7.7 18h8.6" />
  </svg>
);

export const IconList = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const IconPeople = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 19a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M17 19a5.5 5.5 0 0 0-2-4.3" />
  </svg>
);

export const IconWave = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 12h2" />
  </svg>
);

export const IconGear = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
  </svg>
);

export const IconChevron = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconPhone = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M5 3h3.5l1.7 4.2-2.1 1.5a12 12 0 0 0 5.2 5.2l1.5-2.1L19 13.5V17a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3 5.2 2 2 0 0 1 5 3z" />
  </svg>
);

export const IconHeadset = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="2.5" y="13.5" width="4" height="6" rx="1.6" />
    <rect x="17.5" y="13.5" width="4" height="6" rx="1.6" />
  </svg>
);

export const IconCheck = ({ size = 14, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.6 2.5L16 9.5" />
  </svg>
);

export const IconX = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconReplay = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
  </svg>
);

const EVENT_ICONS: Record<string, (p: P) => ReactElement> = {
  collision: IconForklift,
  rack_collapse: IconRack,
  alarm: IconBell,
  chemical_smell: IconDroplet,
  smoke: IconSmoke,
  fire: IconFlame,
  spill: IconDroplet,
  shouting: IconMegaphone,
  evacuation: IconExit,
  injury: IconMedical,
  truck_arrival: IconTruck,
  radio: IconRadio,
};

export function EventIcon({ eventKey, size = 19 }: { eventKey: string; size?: number }) {
  const Cmp = EVENT_ICONS[eventKey] ?? IconAlert;
  return <Cmp size={size} />;
}
