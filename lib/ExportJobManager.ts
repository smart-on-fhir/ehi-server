import { readdirSync, statSync } from "fs"
import Path                      from "path"
import config                    from "../config"
import ExportJob                 from "./ExportJob"


let timer: NodeJS.Timeout;

export async function check(dir = "jobs") {
    const base  = Path.join(__dirname, "..", dir)
    const items = readdirSync(base);
    for (const id of items) {
        if (statSync(Path.join(base, id)).isDirectory()) {
            await ExportJob.destroyIfNeeded(id)
        }
    }
}

export async function start() {
    check()
    if (!timer) {
        timer = setTimeout(start, config.jobCleanupMinutes * 60000).unref()
    }
}

export async function stop() {
    if (timer) {
        clearTimeout(timer)
    }
}
