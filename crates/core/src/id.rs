// crates/core/src/id.rs

use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

// ── ID Type Definitions ──────────────────────────────────────────────────

/// Generational arena index for internal node references.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId {
    pub(crate) index: u32,
    pub(crate) generation: u64,
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({}:gen{})", self.index, self.generation)
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({}:gen{})", self.index, self.generation)
    }
}

/// Unique identifier for a component definition.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ComponentId(pub(crate) Uuid);

impl fmt::Debug for ComponentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ComponentId({})", self.0)
    }
}

impl fmt::Display for ComponentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a design token.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TokenId(pub(crate) Uuid);

impl fmt::Debug for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TokenId({})", self.0)
    }
}

impl fmt::Display for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Unique identifier for a page.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PageId(pub(crate) Uuid);

impl fmt::Debug for PageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PageId({})", self.0)
    }
}

impl fmt::Display for PageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

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

    #[test]
    fn test_node_id_debug() {
        let id = NodeId::new(42, 7);
        let debug = format!("{id:?}");
        assert!(debug.contains("42"), "expected index: {debug}");
        assert!(debug.contains("gen7"), "expected generation: {debug}");
    }

    #[test]
    fn test_component_id_debug() {
        let id = ComponentId::new(Uuid::nil());
        let debug = format!("{id:?}");
        assert!(debug.contains("ComponentId"), "expected wrapper: {debug}");
    }

    #[test]
    fn test_token_id_display() {
        let id = TokenId::new(Uuid::nil());
        let display = format!("{id}");
        assert!(display.contains("00000000"), "expected uuid: {display}");
    }

    #[test]
    fn test_page_id_debug() {
        let id = PageId::new(Uuid::nil());
        let debug = format!("{id:?}");
        assert!(debug.contains("PageId"), "expected wrapper: {debug}");
    }
}
