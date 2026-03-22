import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase.js";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

// ── Fetch vocabulary ──

export function useVocabulary(search) {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/vocabulary${params}`, { headers });
      if (!res.ok) throw new Error("Failed to fetch vocabulary");
      const list = await res.json();
      setData(list);
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, isLoading, error, refresh };
}

// ── Add vocabulary words ──

export function useAddVocabulary() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const addWords = useCallback(async (words) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/vocabulary", {
        method: "POST",
        headers,
        body: JSON.stringify({ words }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add words");
      }
      return await res.json();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { addWords, isLoading, error };
}

// ── Update a vocabulary entry ──

export function useUpdateVocabulary() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const updateWord = useCallback(async (id, updates) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/vocabulary", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update word");
      }
      return await res.json();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { updateWord, isLoading, error };
}

// ── Delete a vocabulary entry ──

export function useDeleteVocabulary() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const deleteWord = useCallback(async (id) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/vocabulary?id=${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete word");
      }
      return await res.json();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { deleteWord, isLoading, error };
}

// ── AI explain ──

export function useExplainWord() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const explain = useCallback(async (word) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/vocabulary/explain", {
        method: "POST",
        headers,
        body: JSON.stringify({ word }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to explain word");
      }
      return await res.json();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { explain, isLoading, error };
}
