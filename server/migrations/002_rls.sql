-- Add RLS for Supabase if queried from client
BEGIN;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Note: Our backend uses a server-side pg pool which bypasses RLS because it usually connects as a superuser or service role.
-- These RLS policies are primarily added as a defense-in-depth in case the tables are exposed directly via Supabase API.

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users FOR SELECT USING (auth.uid() = id);

-- Groups: members can read group details
CREATE POLICY "Members can read groups" ON groups FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_members WHERE group_id = groups.id AND user_id = auth.uid())
);

-- Group Members: members can read other members in their group
CREATE POLICY "Members can read group_members" ON group_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid())
);

-- Markets: members can read markets in their group
CREATE POLICY "Members can read markets" ON markets FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_members WHERE group_id = markets.group_id AND user_id = auth.uid())
);

-- Predictions: members can read predictions for markets in their group
CREATE POLICY "Members can read predictions" ON predictions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM markets m
    JOIN group_members gm ON m.group_id = gm.group_id
    WHERE m.id = predictions.market_id AND gm.user_id = auth.uid()
  )
);

-- Resolutions: members can read resolutions for markets in their group
CREATE POLICY "Members can read resolutions" ON resolutions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM markets m
    JOIN group_members gm ON m.group_id = gm.group_id
    WHERE m.id = resolutions.market_id AND gm.user_id = auth.uid()
  )
);

-- Ledger Entries: members can read ledger entries for markets in their group
CREATE POLICY "Members can read ledger" ON ledger_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM markets m
    JOIN group_members gm ON m.group_id = gm.group_id
    WHERE m.id = ledger_entries.market_id AND gm.user_id = auth.uid()
  )
);

COMMIT;
