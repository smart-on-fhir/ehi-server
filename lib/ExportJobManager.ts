import Path          from "path"
import { readdir }   from "fs/promises"
import config        from "../config"
import { ExportJob } from "./ExportJob"


let timer: NodeJS.Timeout;

export async function check(dir = "jobs") {
    const base  = Path.join(__dirname, "..", dir)
    const items = await readdir(base, { withFileTypes: true });
    for (const entry of items) {
        if (entry.isDirectory()) {
            await ExportJob.destroyIfNeeded(entry.name).catch(console.error)
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
