declare module 'simple-peer-light' {
  namespace SimplePeer {
    interface Options {
      initiator?: boolean;
      channelConfig?: object;
      channelName?: string;
      config?: object;
      offerOptions?: object;
      answerOptions?: object;
      sdpTransform?: (sdp: string) => string;
      stream?: MediaStream;
      streams?: MediaStream[];
      trickle?: boolean;
      allowHalfTrickle?: boolean;
      objectMode?: boolean;
    }

    interface Instance extends EventEmitter {
      signal(data: any): void;
      send(data: any): void;
      destroy(onclose?: () => void): void;
      _senders: Array<{track: MediaStreamTrack}>;
    }
  }

  interface EventEmitter {
    on(event: 'signal', listener: (data: any) => void): this;
    on(event: 'stream', listener: (stream: MediaStream) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: Function): this;
    once(event: string, listener: Function): this;
    off(event: string, listener: Function): this;
    removeListener(event: string, listener: Function): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: any[]): boolean;
    listenerCount(event: string): number;
  }

  class SimplePeer {
    constructor(opts?: SimplePeer.Options);
    signal(data: any): void;
    send(data: any): void;
    destroy(onclose?: () => void): void;
    on(event: 'signal', listener: (data: any) => void): this;
    on(event: 'stream', listener: (stream: MediaStream) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: Function): this;
  }

  export default SimplePeer;
}