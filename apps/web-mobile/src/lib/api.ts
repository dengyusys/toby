import { createSystemClient } from "@toby/contract";

// Same-origin API: an empty base URL keeps requests on the serving origin
// (the dev server proxies /api to the Toby server on 8629). Domain clients
// are constructed once here and imported by the feature pages.
export const systemClient = createSystemClient("");
