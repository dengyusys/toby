/**
 * Toolchain guard: vitest must emit decorator metadata (design:paramtypes)
 * exactly like the tsc build. Constructor injection and @nestjs/testing
 * silently resolve to undefined dependencies without it — this suite makes
 * that failure loud instead. It exists because the swc transform in
 * vitest.config.ts is the only thing guaranteeing the metadata; if the
 * plugin is dropped or breaks, this test fails first.
 */

import "reflect-metadata";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

@Injectable()
class InnerService {
  value(): string {
    return "inner";
  }
}

@Injectable()
class OuterService {
  constructor(readonly inner: InnerService) {}

  value(): string {
    return `outer(${this.inner.value()})`;
  }
}

@Module({
  providers: [InnerService, OuterService],
  exports: [OuterService],
})
class ProbeModule {}

describe("vitest emits decorator metadata", () => {
  it("design:paramtypes is present on decorated classes", () => {
    const paramTypes = Reflect.getMetadata(
      "design:paramtypes",
      OuterService,
    ) as unknown[] | undefined;
    expect(paramTypes).toBeDefined();
    expect(paramTypes).toEqual([InnerService]);
  });

  it("constructor injection resolves through the Nest container", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    const outer = moduleRef.get(OuterService);
    expect(outer.inner).toBeInstanceOf(InnerService);
    expect(outer.value()).toBe("outer(inner)");
  });
});
