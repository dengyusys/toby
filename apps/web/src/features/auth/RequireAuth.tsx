/**
 * Session gate for every route except /login and /register: pages mount only
 * inside the gate's outlet, so an unauthenticated visitor never mounts chat
 * or its requests (main.tsx's 401 redirect is only the fallback). Rendering
 * waits for the session answer so a stale cache never flashes.
 */

import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router";
import { authClient } from "@/lib/api.ts";

export function RequireAuth() {
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => authClient.session(),
    retry: false,
    staleTime: 60_000,
  });

  if (sessionQuery.isPending || sessionQuery.isFetching) {
    return null;
  }

  if (sessionQuery.data?.state === "authenticated") {
    return <Outlet />;
  }

  // A deployment without a password has no login to offer — only the
  // one-time registration.
  return (
    <Navigate
      to={sessionQuery.data?.state === "unregistered" ? "/register" : "/login"}
      replace
    />
  );
}
