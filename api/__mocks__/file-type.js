// api/__mocks__/file-type.js
module.exports = {
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' }),
};
