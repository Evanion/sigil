// crates/core/src/id.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::error::{ComponentId, NodeId, PageId, TokenId};

// ── Serde for NodeId ───────────────────────────────────────────────────

impl Serialize for NodeId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("NodeId", 2)?;
        state.serialize_field("index", &self.index)?;
        state.serialize_field("generation", &self.generation)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for NodeId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct NodeIdHelper {
            index: u32,
            generation: u64,
        }
        let helper = NodeIdHelper::deserialize(deserializer)?;
        Ok(Self {
            index: helper.index,
            generation: helper.generation,
        })
    }
}

// ── Serde for ComponentId ──────────────────────────────────────────────

impl Serialize for ComponentId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ComponentId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Serde for TokenId ──────────────────────────────────────────────────

impl Serialize for TokenId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TokenId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Serde for PageId ───────────────────────────────────────────────────

impl Serialize for PageId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PageId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let uuid = Uuid::deserialize(deserializer)?;
        Ok(Self(uuid))
    }
}

// ── Convenience constructors ───────────────────────────────────────────

impl NodeId {
    /// Creates a new `NodeId`. Used by the arena when allocating nodes.
    #[must_use]
    pub fn new(index: u32, generation: u64) -> Self {
        Self { index, generation }
    }

    /// Returns the arena index.
    #[must_use]
    pub fn index(self) -> u32 {
        self.index
    }

    /// Returns the generation counter.
    #[must_use]
    pub fn generation(self) -> u64 {
        self.generation
    }
}

impl ComponentId {
    /// Creates a new `ComponentId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

impl TokenId {
    /// Creates a new `TokenId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

impl PageId {
    /// Creates a new `PageId` from a UUID.
    #[must_use]
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Returns the inner UUID.
    #[must_use]
    pub fn uuid(self) -> Uuid {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_id_new_and_accessors() {
        let id = NodeId::new(42, 7);
        assert_eq!(id.index(), 42);
        assert_eq!(id.generation(), 7);
    }

    #[test]
    fn test_node_id_serde_round_trip() {
        let id = NodeId::new(10, 99);
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: NodeId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_component_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = ComponentId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_component_id_serde_round_trip() {
        let id = ComponentId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: ComponentId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_token_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = TokenId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_token_id_serde_round_trip() {
        let id = TokenId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: TokenId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_page_id_new_and_uuid() {
        let uuid = Uuid::nil();
        let id = PageId::new(uuid);
        assert_eq!(id.uuid(), uuid);
    }

    #[test]
    fn test_page_id_serde_round_trip() {
        let id = PageId::new(Uuid::nil());
        let json = serde_json::to_string(&id).expect("serialize");
        let deserialized: PageId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, deserialized);
    }

    #[test]
    fn test_node_id_hash_works() {
        use std::collections::HashMap;
        let mut map = HashMap::new();
        let id = NodeId::new(1, 0);
        map.insert(id, "node");
        assert_eq!(map.get(&id), Some(&"node"));
    }

    #[test]
    fn test_component_id_hash_works() {
        use std::collections::HashMap;
        let mut map = HashMap::new();
        let id = ComponentId::new(Uuid::nil());
        map.insert(id, "component");
        assert_eq!(map.get(&id), Some(&"component"));
    }
}
