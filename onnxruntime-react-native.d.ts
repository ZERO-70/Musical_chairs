// onnxruntime-react-native.d.ts
declare module 'onnxruntime-react-native' {
    export interface SessionOptions {
        // Define any session options if needed.
    }

    export class InferenceSession {
        static create(modelPath: string, options?: SessionOptions): Promise<InferenceSession>;
        run(feeds: { [name: string]: Tensor }): Promise<{ [name: string]: any }>;
    }

    export class Tensor {
        constructor(type: string, data: Float32Array | Int32Array, dims: number[]);
        data: Float32Array | Int32Array;
        dims: number[];
        type: string;
    }
}
