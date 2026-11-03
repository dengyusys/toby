/**
 * Session gate for every route except /login: the auth session is checked
 * before any page renders, so an unauthenticated visit lands on the login
 * page instead of the chat page (which fires no request of its own until
 * the user acts, so the 401 redirect never triggers on entry). Deployments
 * without a password render straight through; rendering is held while the
 * session answer is still on its way so a stale cache never flashes the
 * page.
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
