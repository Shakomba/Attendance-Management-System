# Student Photo Folder

Put each student's registration photo in this folder.

Recommended naming:
- `student_photos/<student_code>.jpg` (example: `student_photos/S003.jpg`)

Then upload to the backend embedding endpoint:

```bash
curl -X POST http://localhost:8000/api/students/<student_id>/face \
  -F "image=@student_photos/<student_code>.jpg"
```

Example for Redeen Sirwan (if `student_id=3`):

```bash
curl -X POST http://localhost:8000/api/students/3/face \
  -F "image=@student_photos/S003.jpg"
```
