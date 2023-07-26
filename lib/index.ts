import Crypto                                               from "crypto"
import jwt                                                  from "jsonwebtoken"
import Path                                                 from "path"
import { NextFunction, Request, Response, RequestHandler }  from "express"
import { readdirSync, statSync }                            from "fs"
import { HttpError, InvalidRequestError, OAuthError }       from "./errors"
import patients                                             from "../data/db"
import config                                               from "../config"
import { EHI }                                              from "../index"


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

export function getPrefixedFilePath(destination: string, fileName: string) {
    let dst = Path.join(destination, fileName), counter = 0;
    while (statSync(dst, { throwIfNoEntry: false })?.isFile()) {
        dst = Path.join(destination, ++counter + "." + fileName)
    }
    return dst
}

export function getPath(obj: any, path: string) {
    return path.split(".").reduce((out, key) => out ? out[key] : undefined, obj)
}

type FHIRPerson = fhir2.Patient | fhir3.Patient | fhir4.Patient | fhir2.Practitioner | fhir3.Practitioner | fhir4.Practitioner

export function toArray(x: any) {
    if (!Array.isArray(x)) {
        return [ x ];
    }
    return x;
}

export function humanName(human: FHIRPerson): string {
    let names = human.name || [];
    if (!Array.isArray(names)) {
        names = [ names ];
    }
    
    let name = names[0];
    
    if (!name) {
        name = { family: [ "No Name Listed" ] };
    }
    
    const prefix = toArray(name.prefix || "").filter(Boolean).join(" ")
    const given  = toArray(name.given  || "").filter(Boolean).join(" ")
    const family = toArray(name.family || "").filter(Boolean).join(" ")
    
    let out = [prefix, given, family].filter(Boolean).join(" ");
    
    if (name.suffix) {
        out += ", " + name.suffix;
    }

    return out;
}

export function requireAdminAuth(req: EHI.UserRequest, res: Response, next: NextFunction) {
    const sid = req.cookies?.sid;
    (req as EHI.UserRequest).user = sid ? config.users.find(u => u.sid === sid) : undefined;
    if (!req.user) {
        return res.status(401).type("text").end("Authorization required");
    }
    next();
}

export async function login(req: Request, res: Response) {

    // 1 second artificial delay to protect from automated brute-force attacks
    await wait(config.authDelay);
        
    const { username, password, remember } = req.body;

    // No such username (Do NOT specify what is wrong in the error message!)
    if (!username || !password) {
        return res.status(401).json({ error: "Invalid username or password" })
    }

    const user = config.users.find(u => u.username === username);

    // No such username (Do NOT specify what is wrong in the error message!)
    if (!user) {
        return res.status(401).json({ error: "Invalid username or password" })
    }

    // Wrong password (Do NOT specify what is wrong in the error message!)
    if (password !== user.password) {
        return res.status(401).json({ error: "Invalid username or password" })
    }

    // Generate SID and update the user in DB
    const sid = Crypto.randomBytes(32).toString("hex");

    // Update user's lastLogin and sid properties
    user.sid = sid

    // Use session cookies by default
    let expires: Date | undefined = undefined

    // If "remember" is set use cookies that expire in one year
    if (remember) {
        expires = new Date()
        expires.setFullYear(new Date().getFullYear() + 1)
    }

    res.cookie("sid", sid, { httpOnly: true, expires, sameSite: "none", secure: true }).json({ username: user.username });
}

export async function logout(req: EHI.UserRequest, res: Response) {
    await wait(config.authDelay);
    delete req.user!.sid;
    return res.clearCookie("sid").end("Logout successful");
}

export function patientLogin(req: EHI.UserRequest, res: Response) { 
    const list: any[] = [];
    patients.forEach((value, key) => {
        list.push({ id: key, name: value.patient.name, birthDate: value.patient.birthDate })
    })
    
    // Turn some unique visitor information (e.g. IP) into a patient-index to
    // promote to the front of the list, reducing patient-collisions across multiple users
    if (list.length > 0) { 
        const seed = req.ip;
        const hash = Crypto.createHash('sha256'); 
        hash.update(seed)
        const hexValue = hash.digest('hex')
        // Use last ten digits only to avoid generating really large numbers.
        // We might lose trailing-digit precision when dealing with massive floats 
        const uniqueValue = parseInt(hexValue.slice(hexValue.length - 10, hexValue.length), 16);
        const indexToPromote = uniqueValue % patients.size;
        [list[0], list[indexToPromote]] = [list[indexToPromote], list[0]]
    }
    
    res.render("patient-login", { patients: list, query: req.query })
}

export async function waitFor(condition: () => any): Promise<void> {
    if (!condition()) {
        await wait(100)
        await waitFor(condition)
    }
}
