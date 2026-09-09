CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(trim(username)) > 0)
);

CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(trim(title)) > 0),
    CHECK (version >= 0)
);

CREATE INDEX idx_boards_user_id ON boards(user_id);

CREATE TABLE board_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (board_id, position),
    CHECK (length(trim(title)) > 0),
    CHECK (position >= 0)
);

CREATE INDEX idx_board_columns_board_id ON board_columns(board_id);

CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (column_id, position),
    CHECK (length(trim(title)) > 0),
    CHECK (position >= 0)
);

CREATE INDEX idx_cards_column_id ON cards(column_id);

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    proposed_operations_json TEXT,
    proposal_status TEXT,
    base_board_version INTEGER,
    created_at TEXT NOT NULL,
    CHECK (role IN ('user', 'assistant')),
    CHECK (length(trim(content)) > 0),
    CHECK (
        proposed_operations_json IS NULL
        OR json_valid(proposed_operations_json)
    ),
    CHECK (
        proposal_status IS NULL
        OR proposal_status IN ('pending', 'confirmed', 'rejected', 'stale')
    ),
    CHECK (
        (
            proposed_operations_json IS NULL
            AND proposal_status IS NULL
            AND base_board_version IS NULL
        )
        OR (
            role = 'assistant'
            AND proposed_operations_json IS NOT NULL
            AND proposal_status IS NOT NULL
            AND base_board_version IS NOT NULL
        )
    )
);

CREATE INDEX idx_chat_messages_board_created
ON chat_messages(board_id, created_at, id);

CREATE INDEX idx_chat_messages_pending_proposals
ON chat_messages(board_id, proposal_status)
WHERE proposal_status = 'pending';
