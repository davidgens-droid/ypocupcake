import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Salad Bowl (/saladbowl) is a separate, account-free party game that only
  // shares the domain: no sign-in, and no forum session is read or refreshed.
  const path = request.nextUrl.pathname
  if (
    path === "/saladbowl" ||
    path.startsWith("/saladbowl/") ||
    path.startsWith("/api/saladbowl/")
  ) {
    return response
  }

  // Pre-Supabase dev mode: skip auth so the UI renders without credentials.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // Public routes: the landing page, sign-in, the auth callback, public
  // signup, and invite links (/join/<token> renders its own sign-in form).
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname === "/signup" ||
    pathname.startsWith("/join/") ||
    pathname === "/"

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  return response
}
