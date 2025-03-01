import { io, Socket } from "socket.io-client";
import { FunctionCallParams } from "../server";

// Define a generic type `PromisifiedRecord<T>`
type PromisifyRecord<T> = {
  // For each key in the input type `T`, `K`, determine the type of the corresponding value
  [K in keyof T]-?: T[K] extends (...args: any[]) => any
    ? // If the value is a function,
      ReturnType<T[K]> extends Promise<any>
      ? // If the return type of the function is already a Promise, leave it as-is
        T[K]
      : // Otherwise, convert the function to return a Promise
        (...args: Parameters<T[K]>) => Promise<ReturnType<T[K]>>
    : // If the value is an object, recursively convert it to a PromisifiedRecord
    T[K] extends object
    ? PromisifyRecord<T[K]>
    : never;
} & { socket: Socket };

export default function Client<
  API extends Record<string | symbol | number, unknown>
>(endpoint: string = "http://localhost:8080") {
  const socket = io(endpoint);

  const queue: { [key: string]: (value: unknown) => void } = {};

  socket.on("function-response", (msg) => {
    const { result, id, status, error } = msg;

    if (status > 200) {
      throw new Error(`ServerError: ${error}`);
    }

    queue[id](result);

    delete queue[id];
  });

  const waitForResult = (id: string, resolve: (value: unknown) => void) => {
    queue[id] = resolve;
  };

  function LogProxy(path: string, options: { socket?: Socket } = {}): unknown {
    return new Proxy(
      {},
      {
        get: function (_, prop) {
          if (prop === "socket") {
            return socket;
          }

          return LogProxy(`${path ? `${path}.` : ""}${String(prop)}`, {
            socket,
          });
        },
        apply: function (_, __, argumentsList) {
          console.info(
            `RocketRPC Client Info: Called function at path: ${path} with parameters: ${argumentsList}`
          );
          const id = `${new Date().valueOf()}-${path}-${JSON.stringify(
            argumentsList
          )}`;

          const functionCallParams: FunctionCallParams = {
            id,
            procedurePath: path,
            params: argumentsList,
          };

          socket.emit("function-call", functionCallParams);

          return new Promise((resolve) => waitForResult(id, resolve));
        },
      }
    );
  }

  return LogProxy("", { socket }) as PromisifyRecord<API>;
}
