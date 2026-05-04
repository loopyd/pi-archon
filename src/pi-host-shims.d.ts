declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionUIContext {
    custom<T>(renderer: (...args: any[]) => any): Promise<T | undefined>;
    notify(message: string, level?: string): void;
    setStatus?(id: string, text: string): void;
    [key: string]: any;
  }

  export interface ExtensionAPI {
    ui?: any;
    exec?: (...args: any[]) => any;
    registerCommand?: (...args: any[]) => any;
    registerMessageRenderer?: (...args: any[]) => any;
    registerRoute?: (...args: any[]) => any;
    sendMessage?: (...args: any[]) => any;
    [key: string]: any;
  }

  export interface ExtensionCommandContext {
    args?: string;
    cwd?: string;
    hasUI?: boolean;
    ui?: ExtensionUIContext;
    [key: string]: any;
  }
}

declare module "@mariozechner/pi-tui" {
  export interface Component {
    render?(width: number, height: number): string[];
    handleInput?(data: string): Promise<boolean> | boolean;
    cursor?(): { x: number; y: number } | null;
  }

  export class Container {
    addChild(...args: any[]): void;
  }

  export class Spacer {
    constructor(...args: any[]);
  }

  export class Text {
    constructor(...args: any[]);
  }

  export class Markdown {
    constructor(...args: any[]);
  }

  export function truncateToWidth(value: string, width: number): string;
  export function visibleWidth(value: string): number;
}