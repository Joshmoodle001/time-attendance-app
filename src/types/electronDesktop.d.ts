export {};

declare global {
  interface Window {
    electronDesktop?: {
      isDesktopApp?: boolean;
      platform?: string;
      versions?: {
        chrome?: string;
        electron?: string;
        node?: string;
      };
    };
  }
}
