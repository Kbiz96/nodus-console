// Where the console finds the Nodus database.
//
// These two values are PUBLIC by design. A Supabase "publishable" key only lets the browser
// ask; the database decides. Row Level Security allows reading only for approved, signed-in
// email addresses, and every change goes through checked database functions. So it is safe for
// this file to sit in a public GitHub repository.
//
// Never put a secret key (sb_secret_… or the old service_role key) or a database password here.

export const SUPABASE_URL = "https://wryvidauwmcczbmstsla.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_owO7VMpQG1o5cFoYzD7FYA_bamtSt0U";
