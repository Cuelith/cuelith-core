import {
  EngineMethods,
  ErrorCode,
  isEngineMethod,
  roleAllows,
  rpcError,
  rpcResult,
  RpcError,
  type EngineMethodName,
  type RpcRequest,
  type RpcResponse,
} from "@cuelith/protocol";
import type { z } from "zod";
import type { EngineContext } from "../context.js";
import type { Session } from "./session.js";

type Spec<N extends EngineMethodName> = (typeof EngineMethods)[N];

export type Handler<N extends EngineMethodName> = (
  ctx: EngineContext,
  session: Session,
  params: z.output<Spec<N>["params"]>,
) => z.input<Spec<N>["result"]> | Promise<z.input<Spec<N>["result"]>>;

export type HandlerMap = { readonly [N in EngineMethodName]?: Handler<N> };

const issuesOf = (error: z.ZodError) =>
  error.issues.map((i) => ({
    message: i.message,
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
  }));

/**
 * Esegue una richiesta applicando i controlli del cap. 23 in quest'ordine:
 * metodo esistente, presentazione (session.hello), abbinamento, ruolo,
 * parametri. Anche il risultato viene validato: un errore del motore non
 * deve mai arrivare alle postazioni come dato malformato.
 */
export async function dispatch(
  request: RpcRequest,
  session: Session,
  ctx: EngineContext,
  handlers: HandlerMap,
): Promise<RpcResponse> {
  const { id, method } = request;
  if (!isEngineMethod(method))
    return rpcError(id, ErrorCode.MethodNotFound, "core.error.methodNotFound");
  const spec = EngineMethods[method];

  if (session.state === "new" && method !== "session.hello") {
    return rpcError(id, ErrorCode.InvalidRequest, "core.error.helloRequired");
  }
  if (session.state !== "authed" && spec.scope !== "session") {
    return rpcError(id, ErrorCode.NotPaired, "core.error.notPaired");
  }

  // Il ruolo si controlla prima dei parametri: chi non puo' usare un comando
  // non riceve nemmeno i dettagli della sua validazione.
  if (
    session.state === "authed" &&
    session.role !== undefined &&
    !roleAllows(session.role, method, spec.scope)
  ) {
    return rpcError(id, ErrorCode.Forbidden, "core.error.forbidden");
  }

  const params = spec.params.safeParse(request.params ?? {});
  if (!params.success) {
    return rpcError(id, ErrorCode.InvalidParameters, "core.error.invalidParams", {
      issues: issuesOf(params.error),
    });
  }

  const handler = handlers[method] as
    ((ctx: EngineContext, session: Session, params: unknown) => unknown) | undefined;
  if (handler === undefined)
    return rpcError(id, ErrorCode.InternalError, "core.error.notImplemented");

  let result: unknown;
  try {
    result = await handler(ctx, session, params.data);
  } catch (error) {
    if (error instanceof RpcError) {
      const object = error.toObject();
      return rpcError(id, object.code, object.message, object.data);
    }
    ctx.logger.error(`errore interno eseguendo ${method}`, error);
    return rpcError(id, ErrorCode.InternalError, "core.error.internal");
  }

  const checked = spec.result.safeParse(result);
  if (!checked.success) {
    ctx.logger.error(`risultato non valido per ${method}`, issuesOf(checked.error));
    return rpcError(id, ErrorCode.InternalError, "core.error.internal");
  }
  return rpcResult(id, checked.data);
}
