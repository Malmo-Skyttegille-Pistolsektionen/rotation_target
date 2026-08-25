#include "embedded_fs.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/errno.h>
#include <sys/stat.h>

#include <cstdlib>
#include <cstring>

#include "config.h"
#include "embedded_index.generated.h"
#include "esp_log.h"
#include "esp_vfs.h"
#include "esp_vfs_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// Emitted by target_add_binary_data() in the root CMakeLists, which assembles
// the blob tools/pack_assets.py produced into .rodata. Reads go straight
// through the pointer: the app image is memory-mapped, so there is no copy and
// no heap anywhere in this file.
extern const uint8_t rt_embedded_start[] asm("rt_embedded_start");

namespace embedded_fs {
namespace {

const char *TAG = "embedded_fs";

struct Entry {
  const char *path;
  uint32_t offset;
  uint32_t size;
};

// Generated, and sorted by path. Every string is a literal in .rodata.
constexpr Entry kEntries[] = {RT_EMBEDDED_ENTRIES};
constexpr size_t kEntryCount = sizeof(kEntries) / sizeof(kEntries[0]);

// One per concurrently open file. Sized against what actually opens one: the
// httpd task serving an asset, the SPA fallback, and later the audio task
// reading a clip. Four would do; eight costs 96 bytes and removes the question.
constexpr int kMaxOpen = 8;

struct OpenFile {
  int entry = -1;  // -1 when the slot is free
  uint32_t position = 0;
};

OpenFile s_open[kMaxOpen];
SemaphoreHandle_t s_lock = nullptr;

struct Lock {
  Lock() {
    if (s_lock != nullptr) xSemaphoreTake(s_lock, portMAX_DELAY);
  }
  ~Lock() {
    if (s_lock != nullptr) xSemaphoreGive(s_lock);
  }
};

// Linear, not binary: a hundred-odd string compares per request is nothing
// beside the TLS-less HTTP round trip they sit inside, and a linear scan cannot
// be subtly wrong about ordering the way a hand-written bisection can.
int find(const char *path) {
  for (size_t i = 0; i < kEntryCount; i++) {
    if (strcmp(kEntries[i].path, path) == 0) return static_cast<int>(i);
  }
  return -1;
}

// Whether anything lives under `path` as a directory. Not stored: directories
// are implied by the paths, so this asks whether any entry is prefixed by
// `path/`. Cheap enough at this scale and one fewer thing for the packer to
// keep consistent.
bool is_directory(const char *path) {
  const size_t len = strlen(path);
  if (len == 0 || (len == 1 && path[0] == '/')) return true;
  for (size_t i = 0; i < kEntryCount; i++) {
    if (strncmp(kEntries[i].path, path, len) == 0 && kEntries[i].path[len] == '/') return true;
  }
  return false;
}

void fill_stat(const Entry &entry, struct stat *out) {
  memset(out, 0, sizeof(*out));
  out->st_mode = S_IFREG | 0444;
  out->st_size = static_cast<off_t>(entry.size);
  out->st_nlink = 1;
}

int vfs_open(void *, const char *path, int flags, int) {
  // Read-only, and not by omission: refusing the write intent here is what
  // makes "no update path can modify this" a property of the filesystem rather
  // than of every caller's good behaviour.
  if ((flags & O_ACCMODE) != O_RDONLY) {
    errno = EROFS;
    return -1;
  }

  const int entry = find(path);
  if (entry < 0) {
    errno = is_directory(path) ? EISDIR : ENOENT;
    return -1;
  }

  Lock lock;
  for (int fd = 0; fd < kMaxOpen; fd++) {
    if (s_open[fd].entry < 0) {
      s_open[fd].entry = entry;
      s_open[fd].position = 0;
      return fd;
    }
  }
  ESP_LOGE(TAG, "Out of file handles opening %s", path);
  errno = ENFILE;
  return -1;
}

int vfs_close(void *, int fd) {
  Lock lock;
  if (fd < 0 || fd >= kMaxOpen || s_open[fd].entry < 0) {
    errno = EBADF;
    return -1;
  }
  s_open[fd].entry = -1;
  return 0;
}

ssize_t vfs_read(void *, int fd, void *dst, size_t size) {
  Lock lock;
  if (fd < 0 || fd >= kMaxOpen || s_open[fd].entry < 0) {
    errno = EBADF;
    return -1;
  }
  const Entry &entry = kEntries[s_open[fd].entry];
  const uint32_t remaining = entry.size - s_open[fd].position;
  const size_t want = size < remaining ? size : remaining;
  memcpy(dst, rt_embedded_start + entry.offset + s_open[fd].position, want);
  s_open[fd].position += static_cast<uint32_t>(want);
  return static_cast<ssize_t>(want);
}

off_t vfs_lseek(void *, int fd, off_t offset, int mode) {
  Lock lock;
  if (fd < 0 || fd >= kMaxOpen || s_open[fd].entry < 0) {
    errno = EBADF;
    return -1;
  }
  const Entry &entry = kEntries[s_open[fd].entry];

  off_t target = 0;
  switch (mode) {
    case SEEK_SET:
      target = offset;
      break;
    case SEEK_CUR:
      target = static_cast<off_t>(s_open[fd].position) + offset;
      break;
    case SEEK_END:
      target = static_cast<off_t>(entry.size) + offset;
      break;
    default:
      errno = EINVAL;
      return -1;
  }

  // Seeking past the end is legal on a writable file and meaningless here, so
  // it is refused rather than clamped: a caller that did it is confused about
  // the file, and answering "fine" would hide that until the read came back
  // empty somewhere else.
  if (target < 0 || target > static_cast<off_t>(entry.size)) {
    errno = EINVAL;
    return -1;
  }
  s_open[fd].position = static_cast<uint32_t>(target);
  return target;
}

int vfs_fstat(void *, int fd, struct stat *out) {
  Lock lock;
  if (fd < 0 || fd >= kMaxOpen || s_open[fd].entry < 0) {
    errno = EBADF;
    return -1;
  }
  fill_stat(kEntries[s_open[fd].entry], out);
  return 0;
}

int vfs_stat(void *, const char *path, struct stat *out) {
  const int entry = find(path);
  if (entry >= 0) {
    fill_stat(kEntries[entry], out);
    return 0;
  }
  // The static file handler stats the directory it is asked to serve before it
  // serves anything out of it, so answering ENOENT for `/webapp` would refuse
  // every asset under it.
  if (is_directory(path)) {
    memset(out, 0, sizeof(*out));
    out->st_mode = S_IFDIR | 0555;
    out->st_nlink = 2;
    return 0;
  }
  errno = ENOENT;
  return -1;
}

// esp_vfs_dir_ops_t and esp_vfs_fs_ops_t both carry members that only exist
// under certain Kconfig options (`termios`, `select`), so an exhaustive
// initialiser would need the same #ifdefs and would break on the next option
// added upstream. Everything not named below is a null pointer, which is how
// the VFS layer is told an operation is unsupported - and here that is nearly
// all of them, because nothing about this filesystem is writable.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"

// --- directory iteration ---------------------------------------------------
//
// Only the program loader needs it (`programs::load_dir` scans for `<id>.json`),
// but it has to be right rather than nearly right: the entries are a flat
// sorted list of full paths, and "the children of /programs" is not something
// the packer stores.

struct EmbeddedDir {
  // Must be first: the VFS layer hands this back to us as a DIR*.
  DIR base;
  char prefix[80];
  size_t prefix_len;
  size_t next;  // index into kEntries
  long offset;  // for telldir/seekdir, counted in entries yielded
  struct dirent entry;
};

// The immediate child of `prefix` that `path` lies under, or nullptr. Writes
// the name into `out` and says whether it is a directory.
const char *child_of(const char *path, const char *prefix, size_t prefix_len, char *out,
                     size_t out_size, bool *is_dir) {
  if (strncmp(path, prefix, prefix_len) != 0 || path[prefix_len] != '/') return nullptr;
  const char *rest = path + prefix_len + 1;
  const char *slash = strchr(rest, '/');
  const size_t len = slash != nullptr ? static_cast<size_t>(slash - rest) : strlen(rest);
  if (len == 0 || len >= out_size) return nullptr;
  memcpy(out, rest, len);
  out[len] = '\0';
  *is_dir = slash != nullptr;
  return out;
}

DIR *vfs_opendir(void *, const char *name) {
  if (!is_directory(name)) {
    errno = ENOENT;
    return nullptr;
  }
  auto *dir = static_cast<EmbeddedDir *>(calloc(1, sizeof(EmbeddedDir)));
  if (dir == nullptr) {
    errno = ENOMEM;
    return nullptr;
  }

  // A trailing slash would make every prefix comparison below off by one, and
  // `/` is the mount root, whose children have no prefix to strip.
  size_t len = strlen(name);
  while (len > 1 && name[len - 1] == '/') len--;
  if (len == 1 && name[0] == '/') len = 0;
  if (len >= sizeof(dir->prefix)) {
    free(dir);
    errno = ENAMETOOLONG;
    return nullptr;
  }
  memcpy(dir->prefix, name, len);
  dir->prefix[len] = '\0';
  dir->prefix_len = len;
  return reinterpret_cast<DIR *>(dir);
}

int vfs_readdir_r(void *, DIR *pdir, struct dirent *entry, struct dirent **out) {
  auto *dir = reinterpret_cast<EmbeddedDir *>(pdir);
  *out = nullptr;
  if (dir == nullptr) return EBADF;

  char name[sizeof(dir->entry.d_name)];
  while (dir->next < kEntryCount) {
    bool is_dir = false;
    const char *found = child_of(kEntries[dir->next].path, dir->prefix, dir->prefix_len, name,
                                 sizeof(name), &is_dir);
    dir->next++;
    if (found == nullptr) continue;

    // Entries are sorted by path, so every file under one subdirectory is
    // adjacent - which is what makes "skip a directory already reported" a
    // comparison against the last name rather than a set.
    if (is_dir && strcmp(name, dir->entry.d_name) == 0) continue;

    memset(entry, 0, sizeof(*entry));
    entry->d_ino = 0;
    entry->d_type = is_dir ? DT_DIR : DT_REG;
    strlcpy(entry->d_name, name, sizeof(entry->d_name));
    // Kept for the adjacency check above as well as for readdir()'s return.
    dir->entry = *entry;
    dir->offset++;
    *out = entry;
    return 0;
  }
  return 0;
}

struct dirent *vfs_readdir(void *ctx, DIR *pdir) {
  auto *dir = reinterpret_cast<EmbeddedDir *>(pdir);
  if (dir == nullptr) {
    errno = EBADF;
    return nullptr;
  }
  struct dirent scratch;
  struct dirent *out = nullptr;
  const int err = vfs_readdir_r(ctx, pdir, &scratch, &out);
  if (err != 0) {
    errno = err;
    return nullptr;
  }
  // Returned from the DIR rather than from the stack: readdir()'s contract is
  // that the pointer stays valid until the next call on the same DIR.
  return out != nullptr ? &dir->entry : nullptr;
}

long vfs_telldir(void *, DIR *pdir) {
  auto *dir = reinterpret_cast<EmbeddedDir *>(pdir);
  if (dir == nullptr) {
    errno = EBADF;
    return -1;
  }
  return dir->offset;
}

void vfs_seekdir(void *ctx, DIR *pdir, long offset) {
  auto *dir = reinterpret_cast<EmbeddedDir *>(pdir);
  if (dir == nullptr) return;
  // Rewind and walk: the mapping from an offset to a position in kEntries is
  // not arithmetic (directories collapse several entries into one), so the
  // only honest way back to offset N is to replay the first N.
  dir->next = 0;
  dir->offset = 0;
  dir->entry.d_name[0] = '\0';
  struct dirent scratch;
  struct dirent *out = nullptr;
  while (dir->offset < offset) {
    vfs_readdir_r(ctx, pdir, &scratch, &out);
    if (out == nullptr) break;
  }
}

int vfs_closedir(void *, DIR *pdir) {
  free(pdir);
  return 0;
}

const esp_vfs_dir_ops_t kDirOps = {
    .stat_p = &vfs_stat,
    .opendir_p = &vfs_opendir,
    .readdir_p = &vfs_readdir,
    .readdir_r_p = &vfs_readdir_r,
    .telldir_p = &vfs_telldir,
    .seekdir_p = &vfs_seekdir,
    .closedir_p = &vfs_closedir,
};

// The `_p` (context-carrying) members throughout: the context-free ones are
// deprecated in ESP-IDF 6 and the build takes warnings seriously. The context
// itself is null - there is exactly one embedded filesystem and it is
// generated, so there is nothing to point at.
const esp_vfs_fs_ops_t kOps = {
    .write_p = nullptr,
    .lseek_p = &vfs_lseek,
    .read_p = &vfs_read,
    .pread_p = nullptr,
    .pwrite_p = nullptr,
    .open_p = &vfs_open,
    .close_p = &vfs_close,
    .fstat_p = &vfs_fstat,
    .fcntl_p = nullptr,
    .ioctl_p = nullptr,
    .fsync_p = nullptr,
    .dir = &kDirOps,
};

#pragma GCC diagnostic pop

}  // namespace

bool init() {
  s_lock = xSemaphoreCreateMutex();
  if (s_lock == nullptr) {
    ESP_LOGE(TAG, "Could not create the file table lock");
    return false;
  }

  const esp_err_t err = esp_vfs_register_fs(
      kEmbeddedMount, &kOps, ESP_VFS_FLAG_STATIC | ESP_VFS_FLAG_CONTEXT_PTR, nullptr);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Could not register %s: %s", kEmbeddedMount, esp_err_to_name(err));
    return false;
  }

  ESP_LOGI(TAG, "%s: %u file(s), %u KB in the app image", kEmbeddedMount,
           static_cast<unsigned>(file_count()), static_cast<unsigned>(size_bytes() / 1024));
  return true;
}

size_t size_bytes() {
  size_t total = 0;
  for (const Entry &entry : kEntries) total += entry.size;
  return total;
}

size_t file_count() {
  // The packer emits one empty sentinel rather than a zero-length array, which
  // is ill-formed C++. An API-only build is the case that produces it.
  if (kEntryCount == 1 && kEntries[0].path[0] == '\0') return 0;
  return kEntryCount;
}

}  // namespace embedded_fs
