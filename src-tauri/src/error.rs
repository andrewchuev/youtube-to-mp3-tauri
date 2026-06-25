use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("State lock poisoned")]
    LockPoisoned,
    #[error("Job not found")]
    JobNotFound,
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Sidecar(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
