
import jwt from "jsonwebtoken"
import Path from "path"
import { NextFunction, Request, Response, RequestHandler } from "express"
import { readdirSync, statSync } from "fs"
import { HttpError, InvalidRequestError, OAuthError } from "./errors"
import config from "../config"


/**
 * Given a request object, returns its base URL
 */
export function getRequestBaseURL(req: Request) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return protocol + "://" + host;
}

/**
 * Creates and returns a route-wrapper function that allows for using an async
 * route handlers without try/catch.
 */
export function asyncRouteWrap(fn: RequestHandler) {
    return (req: Request, res: Response, next: NextFunction) => Promise.resolve(
        fn(req, res, next)
    ).catch(next);
}

export function wait(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export function htmlEncode(html: string): string {
    return String(html)
        .trim()
        .replace(/&/g, "&amp;" )
        .replace(/</g, "&lt;"  )
        .replace(/>/g, "&gt;"  )
        .replace(/"/g, "&quot;");
}

export function requireUrlencodedPost(req: Request) {
    if (!req.is("application/x-www-form-urlencoded")) {
        throw new InvalidRequestError(
            "Invalid request content-type header '%s' (must be 'application/x-www-form-urlencoded')",
            req.headers["content-type"]
        ).status(400)
    }
}

// export function notSupported(message: string = "", code = 400) {
//     return (req: Request) => {
//         throw new HttpError(message || `${req.method} ${req.originalUrl} is not supported by this server`).status(code)
//     };
// }


export function validateToken(required = true) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.headers.authorization) {
            if (required) {
                return next(new HttpError("Unauthorized! No authorization header provided in request.").status(401))
            }
            return next();
        }

        // require a valid auth token if there is an auth token
        try {
            var token = jwt.verify(
                req.headers.authorization.split(" ")[1],
                config.jwtSecret
            );
        } catch (e) {
            return next(new HttpError("Invalid token: " + (e as Error).message).status(401))
        }

        if (!token || typeof token !== "object") {
            return next(new HttpError("Invalid token").status(400))
        }

        next()
    }
}

// export function authenticate({ checkOnly }: { checkOnly?: boolean }) {
//     return (req: Request, res: Response, next: NextFunction) => {
        
//         // No token provided
//         if (!req.headers.authorization) {
            
//             // Do not attempt to authorize. Just show an error.
//             if (checkOnly) {
//                 return next(new HttpError("Unauthorized! No authorization header provided in request.").status(401))
//             }

//             // Attempt to authorize if possible

//             return next();
//         }

//         try {
//             var token = jwt.verify(
//                 req.headers.authorization.split(" ")[1],
//                 config.jwtSecret
//             );
//         } catch (e) {
//             return next(new HttpError("Invalid token: " + (e as Error).message).status(401))
//         }

//         if (!token || typeof token !== "object") {
//             return next(new HttpError("Invalid token").status(400))
//         }
//     }
// }

export function createOperationOutcome(message: string, {
    issueCode = "processing", // http://hl7.org/fhir/valueset-issue-type.html
    severity  = "error"       // fatal | error | warning | information
}: {
    issueCode?: string
    severity?: "fatal" | "error" | "warning" | "information"
} = {}): fhir4.OperationOutcome
{
    return {
        resourceType: "OperationOutcome",
        text: {
            status: "generated",
            div: `<div xmlns="http://www.w3.org/1999/xhtml">` +
                `<h1>Operation Outcome</h1><table border="0"><tr>` +
                `<td style="font-weight:bold;">${severity}</td>` +
                `<td><pre>${htmlEncode(message)}</pre></td></tr></table></div>`
        },
        issue: [
            {
                severity,
                code       : issueCode,
                diagnostics: message
            }
        ]
    };
}

/**
 * Walk a directory recursively and find files that match the @filter if its a
 * RegExp, or for which @filter returns true if its a function.
 */
export function* filterFiles(dir: string, filter: RegExp|((file: string) => boolean)): IterableIterator<String> {
    const files = walkSync(dir);
    for (const file of files) {
        if (filter instanceof RegExp && !filter.test(file)) {
            continue;
        }
        if (typeof filter == "function" && !filter(file)) {
            continue;
        }
        yield file;
    }
}

/**
 * List all files in a directory recursively in a synchronous fashion.
 */
export function* walkSync(dir: string): IterableIterator<string> {
    const files = readdirSync(dir);

    for (const file of files) {
        const pathToFile = Path.join(dir, file);
        const isDirectory = statSync(pathToFile).isDirectory();
        if (isDirectory) {
            yield *walkSync(pathToFile);
        } else {
            yield pathToFile;
        }
    }
}

export function validateParam(container: any, name: string, validator?: ((value: string) => any) | string | RegExp) {
    if (!container[name]) {
        throw new OAuthError(`Missing "${name}" parameter`)
            .errorId("invalid_request")
            .status(400);
    }

    if (validator) {
        
        if (typeof validator === "string") {
            if (container[name] !== validator) {
                throw new OAuthError(`Invalid "${name}" parameter. Value must be ${JSON.stringify(validator)}.`)
                .errorId("invalid_request")
                .status(400);    
            }
            return true
        }

        if (validator instanceof RegExp) {
            if (!container[name].match(validator)) {
                throw new OAuthError(`Invalid "${name}" parameter. Value must match ${JSON.stringify(validator.source)}.`)
                .errorId("invalid_request")
                .status(400);    
            }
            return true
        }

        try {
            var result = validator(container[name])
        } catch (ex) {
            if (ex instanceof OAuthError) {
                throw ex
            }
            throw new OAuthError(`Invalid "${name}" parameter: ${(ex as Error).message}`)
            .errorId("invalid_request")
            .status(400);
        }

        if (result === false) {
            throw new OAuthError(`Invalid "${name}" parameter.`)
            .errorId("invalid_request")
            .status(400);
        }
    }
}

export function parseNdjson<T = unknown>(data: string): T[] {
    return data.trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T)
}

export function getPrefixedFilePath(destination: string, fileName: string) {
    let dst = Path.join(destination, fileName), counter = 0;
    while (statSync(dst, { throwIfNoEntry: false })?.isFile()) {
        dst = Path.join(destination, ++counter + "." + fileName)
    }
    return dst
}

export function getPath(obj: any, path = "") {
    return path.split(".").reduce((out, key) => out ? out[key] : undefined, obj)
}