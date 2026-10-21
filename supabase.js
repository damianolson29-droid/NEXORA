

"use strict";

// ========================================
// NEXORA — SUPABASE CLIENT
// DEMO ONLY — NO REAL CRYPTOCURRENCY SENT
// ========================================

const SUPABASE_URL =
  "https://fookafzcsnlmxjlormlf.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable__QTEEc_XvGKt_TMj1P9D1w_No7_sQXo";

// Check Supabase library
if (!window.supabase) {
  throw new Error(
    "Supabase library missing. Load supabase-js before supabase.js."
  );
}

// Create one shared client
window.nexoraSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

// ========================================
// NEXORA API
// ========================================

window.Nexora = {
  client: window.nexoraSupabase,

  // Reuse the current session, or create an anonymous demo session.
  
async getCurrentUser() {
  const { data: sessionData, error: sessionError } =
    await this.client.auth.getSession();

  if (sessionError) throw sessionError;

  if (sessionData.session?.user) {
    return sessionData.session.user;
  }

  const { data, error } =
    await this.client.auth.signInAnonymously();

  if (error) throw error;

  if (!data.user) {
    throw new Error("Could not create an anonymous session.");
  }

  return data.user;
},

    

  // Optional email/password methods retained for future use.
  async signIn(email, password) {
    const { data, error } =
      await this.client.auth.signInWithPassword({
        email: email.trim(),
        password
      });

    if (error) throw error;
    return data.user;
  },

  async signUp(email, password) {
    const { data, error } =
      await this.client.auth.signUp({
        email: email.trim(),
        password
      });

    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  },

  // Load balances belonging to this browser's current user.
  async getBalances() {
    const user = await this.getCurrentUser();

    const { data, error } = await this.client
      .from("nexora_balances")
      .select("asset, balance")
      .eq("user_id", user.id);

    if (error) throw error;

    console.log("NEXORA active user:", user.id);
    console.log("NEXORA balance rows:", data?.length ?? 0);

    return data ?? [];
  },

  // Load this user's demo withdrawal history.
  async getTransactions() {
    const user = await this.getCurrentUser();

    const { data, error } = await this.client
      .from("nexora_withdrawals")
      .select(
        "id, asset, amount, destination, status, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  },

  // Send the amount and destination to the Supabase RPC.
  async requestWithdrawal({ asset, amount, destination }) {
    await this.getCurrentUser();

    const supportedAssets = ["BTC", "ETH", "USDT", "USD"];

    if (!supportedAssets.includes(asset)) {
      throw new Error("Unsupported demo asset.");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a valid withdrawal amount.");
    }

    if (
      typeof destination !== "string" ||
      destination.trim().length < 6
    ) {
      throw new Error("Enter a valid demo destination.");
    }

    const { data, error } = await this.client.rpc(
      "nexora_request_withdrawal",
      {
        p_asset: asset,
        p_amount: amount,
        p_destination: destination.trim()
      }
    );

    if (error) throw error;

    return data;
  }
};