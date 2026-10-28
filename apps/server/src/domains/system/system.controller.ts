/** System routes: a pure HTTP shell; health is `@Public`. */

import { Controller, Get } from "@nestjs/common";
import { Public } from "../../infrastructure/http/public.decorator.ts";
import { SystemService } from "./system.service.ts";
import type { SystemHealth, SystemInfo } from "./types.ts";

@Controller("api/system")
export class SystemController {
  constructor(private readonly service: SystemService) {}

  @Public()
  @Get("health")
  health(): SystemHealth {
    return this.service.health();
  }

  @Get("info")
  info(): SystemInfo {
    return this.service.info();
  }
}
