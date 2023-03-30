import { readFileSync } from "fs"
import { basename } from "path"
import { filterFiles } from "../lib"

const patients = new Map<string, { patient: fhir4.Patient; file: string }>()

// ========================================================================== //
//                         LOAD PATIENTS MAP IN MEMORY                        //
//                                                                            //
// Only do this for patients since we use tem frequently. Other resources can //
// be loaded on demand while exporting                                        //
// ========================================================================== //
for (const path of filterFiles(
    __dirname + "/fhir",
    x => (
        x.endsWith(".json") &&
        !basename(x).startsWith("groupInformation") &&
        !basename(x).startsWith("hospitalInformation") &&
        !basename(x).startsWith("practitionerInformation")
    )
)) {
    const data = readFileSync(path + "", "utf8")
    const json = JSON.parse(data) as fhir4.Bundle
    const pt = json.entry?.find(entry => entry.resource?.resourceType === "Patient")?.resource
    if (pt) {
        patients.set(pt.id!, {
            patient: pt as fhir4.Patient,
            file: path + ""
        })
    }
}
// console.log(patients)
// =============================================================================

export default patients