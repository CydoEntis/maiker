//! The native terminal of a conversation: its screen, replay, input and size.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_terminal_screen(
        &self,
        id: ConversationId,
        generation: u64,
    ) -> Result<String> {
        let term = self.conversation_terminal_term(id, generation)?;
        let pane = self
            .terms
            .get(&term)
            .ok_or_else(|| anyhow::anyhow!("Native conversation terminal is not running"))?;
        let mut screen = b"\x1b[0m\x1b[2J\x1b[H".to_vec();
        screen.extend(pane.parser.screen().state_formatted());
        Ok(String::from_utf8_lossy(&screen).into_owned())
    }

    pub(in crate::daemon) fn conversation_terminal_replay(
        &self,
        id: ConversationId,
        generation: u64,
    ) -> Result<Vec<u8>> {
        let term = self.conversation_terminal_term(id, generation)?;
        let pane = self
            .terms
            .get(&term)
            .ok_or_else(|| anyhow::anyhow!("Native conversation terminal is not running"))?;
        Ok(pane.replay())
    }

    pub(in crate::daemon) fn conversation_terminal_input(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        anyhow::ensure!(
            !data.is_empty() && data.len() <= MAX_NATIVE_TERMINAL_INPUT_BYTES,
            "Native terminal input must contain between 1 and {MAX_NATIVE_TERMINAL_INPUT_BYTES} bytes"
        );
        let term = self.conversation_terminal_term(id, generation)?;
        let asking = self
            .terms
            .get(&term)
            .is_some_and(|pane| pane.status == crate::protocol::Status::Blocked);
        self.may(client, Grant::Write, Some(term))?;
        if asking {
            self.may(client, Grant::Respond, Some(term))?;
        }
        self.terms
            .get_mut(&term)
            .ok_or_else(|| anyhow::anyhow!("Native conversation terminal is not running"))?
            .input(&data);
        Ok(())
    }

    pub(in crate::daemon) fn conversation_terminal_resize(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        anyhow::ensure!(
            (MIN_NATIVE_TERMINAL_DIMENSION..=MAX_NATIVE_TERMINAL_COLS).contains(&cols)
                && (MIN_NATIVE_TERMINAL_DIMENSION..=MAX_NATIVE_TERMINAL_ROWS).contains(&rows),
            "Native terminal size must be between 2x2 and 500x300"
        );
        let term = self.conversation_terminal_term(id, generation)?;
        self.may(client, Grant::Write, Some(term))?;
        self.terms
            .get_mut(&term)
            .ok_or_else(|| anyhow::anyhow!("Native conversation terminal is not running"))?
            .resize(cols, rows);
        self.dirty = true;
        Ok(())
    }

    pub(super) fn conversation_terminal_term(
        &self,
        id: ConversationId,
        generation: u64,
    ) -> Result<crate::protocol::TermId> {
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        anyhow::ensure!(
            conversation.generation == generation,
            "Native terminal request is stale"
        );
        anyhow::ensure!(
            conversation.execution == crate::conversation::ExecutionKind::Native,
            "Conversation is not owned by a native terminal"
        );
        let pane = self
            .terms
            .values()
            .find(|pane| pane.conversation_id == Some(id) && !pane.asleep)
            .ok_or_else(|| anyhow::anyhow!("Native conversation terminal is not running"))?;
        Ok(pane.id)
    }
}
