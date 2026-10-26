import type { SVGProps } from 'react';

/** Iconos de trazo (24×24), heredan el color del texto. */
function Icon({ d, ...p }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d={d} />
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;
export const IconClock = (p: P) => <Icon {...p} d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />;
export const IconRoute = (p: P) => <Icon {...p} d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />;
export const IconGauge = (p: P) => <Icon {...p} d="M12 14l4-4M3.5 18a9 9 0 1 1 17 0" />;
export const IconUsers = (p: P) => <Icon {...p} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />;
export const IconHeart = (p: P) => <Icon {...p} d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />;
export const IconBattery = (p: P) => <Icon {...p} d="M17 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1ZM22 11v2" />;
export const IconSignal = (p: P) => <Icon {...p} d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16" />;
export const IconFlag = (p: P) => <Icon {...p} d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />;
export const IconSun = (p: P) => <Icon {...p} d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />;
export const IconMoon = (p: P) => <Icon {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />;
export const IconMapPin = (p: P) => <Icon {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />;
export const IconCalendar = (p: P) => <Icon {...p} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />;
export const IconSearch = (p: P) => <Icon {...p} d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35" />;
export const IconDownload = (p: P) => <Icon {...p} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />;
export const IconChip = (p: P) => <Icon {...p} d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 9h6v6H9z" />;
export const IconSettings = (p: P) => <Icon {...p} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />;
export const IconBike = (p: P) => <Icon {...p} d="M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 17.5V14l-3-3 4-3 2 3h2" />;
