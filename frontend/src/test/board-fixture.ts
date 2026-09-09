export type ApiBoardFixture = {
  id: string;
  title: string;
  version: number;
  columns: Array<{
    id: string;
    title: string;
    position: number;
    cards: Array<{
      id: string;
      title: string;
      details: string;
      position: number;
    }>;
  }>;
};

export const boardFixture = (): ApiBoardFixture => ({
  id: "0199224c-0000-7000-8000-000000000001",
  title: "Kanban Studio",
  version: 0,
  columns: [
    {
      id: "0199224c-0000-7000-8000-000000000010",
      title: "Backlog",
      position: 0,
      cards: [
        {
          id: "0199224c-0000-7000-8000-000000000101",
          title: "Align roadmap themes",
          details: "Draft quarterly themes.",
          position: 0,
        },
      ],
    },
    {
      id: "0199224c-0000-7000-8000-000000000011",
      title: "Review",
      position: 1,
      cards: [
        {
          id: "0199224c-0000-7000-8000-000000000102",
          title: "QA micro-interactions",
          details: "Verify hover and focus states.",
          position: 0,
        },
      ],
    },
  ],
});

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
