import type { DesktopReportJob, DesktopReportJobResult } from "@/types/desktopReportBridge";

declare global {
  interface Window {
    electronDesktop?: {
      isDesktopApp?: boolean;
      platform?: string;
      versions?: {
        chrome: string;
        electron: string;
        node: string;
      };
      machine?: {
        cpuCores: number;
        memoryGB: number;
      };
      downloadShiftFile?: (url: string) => Promise<number[]>;
      parseShiftWorkbook?: (payload: unknown) => Promise<unknown>;
      syncShiftFiles?: (payload: unknown) => Promise<unknown>;
      applyDeviceRegions?: (payload: unknown) => Promise<unknown>;
      printReport?: (payload: unknown) => Promise<unknown>;
      notifyReportWorkerReady?: () => Promise<boolean>;
      completeReportJob?: (payload: DesktopReportJobResult) => Promise<boolean>;
      onReportJob?: (callback: (payload: DesktopReportJob) => void) => (() => void) | void;
      remoteBridge?: {
        baseUrl: string;
        token: string;
        serverId: string;
        pollingMode?: "main" | "renderer";
      };
      getWorkerConfig?: () => Promise<{ workerPriority: "primary" | "secondary"; workerId: string; vcellRole: string }>;
      setWorkerConfig?: (config: { workerPriority?: "primary" | "secondary" }) => Promise<{ workerPriority: "primary" | "secondary"; workerId: string; vcellRole: string }>;
      vcellAssignRole?: (role: "primary" | "secondary") => Promise<{ success?: boolean; role?: string; error?: string }>;
      getMachineContext?: () => Promise<{
        machineId: string;
        serverId: string;
        machineLabel: string;
        hostname: string;
        setupComplete: boolean;
        needsSetup: boolean;
        copiedToNewMachine?: boolean;
        dataDirectory?: string;
        workerPriority?: "primary" | "secondary";
        workerId?: string;
        vcellRole?: string;
      }>;
      completePortableSetup?: (payload: { primary?: boolean }) => Promise<{ error?: string } | unknown>;
    };
  }
}

export {};
