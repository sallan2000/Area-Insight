import { useMutation, useQuery } from "@tanstack/react-query";
import { api, buildUrl, type AssessInput } from "@shared/routes";
import { useLocation } from "wouter";

export function useCreateAssessment() {
  const [, setLocation] = useLocation();
  
  return useMutation({
    mutationFn: async (data: AssessInput) => {
      const validated = api.assess.create.input.parse(data);
      
      const res = await fetch(api.assess.create.path, {
        method: api.assess.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.assess.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create assessment");
      }

      return api.assess.create.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      setLocation(`/report/${data.shareToken}`);
    },
  });
}

export function useAssessment(token: string | null | undefined) {
  return useQuery({
    queryKey: [api.assess.get.path, token],
    queryFn: async () => {
      if (!token) throw new Error("Token is required");
      
      const url = buildUrl(api.assess.get.path, { token });
      const res = await fetch(url);
      
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch assessment");
      
      return api.assess.get.responses[200].parse(await res.json());
    },
    enabled: !!token,
  });
}
