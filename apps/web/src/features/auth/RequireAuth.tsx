/**
 * Session gate for every route except /login: pages mount only inside the
 * gate's outlet, so an unauthenticated visitor never mounts chat or its
 * requests (main.tsx's 401 redirect is only the fallback). Rendering waits
 * for the session answer so a stale cache never flashes.
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

  if (
    sessionQuery.data &&
    (!sessionQuery.data.enabled || sessionQuery.data.authenticated)
  ) {
    return <Outlet />;
  }

  return <Navigate to="/login" replace />;
}
