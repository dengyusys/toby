# Why NestJS

English | [简体中文](nestjs-server-stack.zh.md)

Without a framework, routing, dependency injection, module assembly, the
request pipeline (validation, guards, error boundary) and the test harness are
all things we would hand-roll — house code that every new contributor and
model has to learn from scratch, and that silently drifts as the app grows.

Nest hands them over as a fixed, documented contract instead. A declarative
module graph the container resolves at boot, so a missing dependency fails at
startup rather than on the first request. One explicit request pipeline whose
order we never have to reinvent. Built-in schema validation and serialization.
A testing utility that assembles the real module graph.

None of it is bespoke here, and its shape is what the wider ecosystem — and
the model writing the code — already writes. It also transfers directly to
Spring Boot: modules ≈ component scan, providers ≈ beans,
guards/pipes/interceptors ≈ filters/validators/interceptors.
