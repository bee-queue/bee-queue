module.exports = function(grunt) {
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-githooks');

  grunt.initConfig({
    eslint: {
      options: {
        config: '.eslintrc'
      },
      target: [
        'lib/**/*.js',
        'test/**/*.js'
      ]
    },
    githooks: {
      all: {
        'pre-commit': 'eslint',
      }
    }
  });

  grunt.registerTask('default', ['eslint']);
};
